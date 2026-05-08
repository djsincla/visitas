import { db } from '../db/index.js';
import { recordAudit } from './audit.js';

/**
 * Visitor bans / denylist.
 *
 * Three match modes (see migrations/009_bans.sql):
 *   - 'visitor' — by visitor record (also matches on by-name fallback when
 *     a sign-in arrives without an email but matches the banned visitor's
 *     visible identity).
 *   - 'email'   — by raw email, case-insensitive.
 *   - 'name'    — name + optional company, case-insensitive substring.
 *
 * Lazy-expired on read: any active row with `expires_at < now` is flipped
 * inactive at lookup time (mirrors the invitation pattern, no scheduler).
 */

// ----------------------------- service API --------------------------------

export function createBan({
  mode, visitorId = null, email = null, namePattern = null, companyPattern = null,
  reason, expiresAt = null, createdByUserId,
}) {
  if (!['visitor', 'email', 'name'].includes(mode)) throw httpError(400, 'invalid mode');
  if (!reason || !reason.trim()) throw httpError(400, 'reason required');

  // Validate the match fields for the given mode.
  if (mode === 'visitor') {
    if (!visitorId) throw httpError(400, 'visitor mode requires visitorId');
    const v = db.prepare('SELECT 1 FROM visitors WHERE id = ?').get(visitorId);
    if (!v) throw httpError(400, 'unknown visitor');
  }
  if (mode === 'email') {
    if (!email || !email.includes('@')) throw httpError(400, 'email mode requires a valid email');
    visitorId = null; namePattern = null; companyPattern = null;
  }
  if (mode === 'name') {
    if (!namePattern || !namePattern.trim()) throw httpError(400, 'name mode requires namePattern');
    visitorId = null; email = null;
  }

  const info = db.prepare(`
    INSERT INTO visitor_bans
      (mode, visitor_id, email, name_pattern, company_pattern, reason, expires_at, created_by_user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(mode, visitorId, email, namePattern, companyPattern, reason, expiresAt, createdByUserId);

  const id = Number(info.lastInsertRowid);
  recordAudit({
    userId: createdByUserId,
    action: 'ban_created',
    subjectType: 'visitor_ban',
    subjectId: id,
    details: { mode, visitorId, email, namePattern, companyPattern, expiresAt },
  });
  return getById(id);
}

export function liftBan({ id, byUserId, liftReason = null }) {
  const r = db.prepare('SELECT id, active FROM visitor_bans WHERE id = ?').get(id);
  if (!r) throw httpError(404, 'ban not found');
  if (!r.active) throw httpError(409, 'ban is not active');

  db.prepare(`
    UPDATE visitor_bans
       SET active = 0, lifted_at = datetime('now'),
           lifted_by_user_id = ?, lift_reason = ?
     WHERE id = ?
  `).run(byUserId, liftReason, id);

  recordAudit({
    userId: byUserId,
    action: 'ban_lifted',
    subjectType: 'visitor_ban',
    subjectId: id,
    details: { liftReason },
  });
  return getById(id);
}

export function getById(id) {
  const r = db.prepare('SELECT * FROM visitor_bans WHERE id = ?').get(id);
  return r ? rowToBan(r) : null;
}

export function listAll({ status = null, limit = 500 } = {}) {
  expireStaleBans();
  let sql = 'SELECT * FROM visitor_bans';
  const params = [];
  if (status === 'active')   { sql += ' WHERE active = 1'; }
  if (status === 'inactive') { sql += ' WHERE active = 0'; }
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);
  return db.prepare(sql).all(...params).map(rowToBan);
}

/**
 * Find an active ban that matches the incoming sign-in attempt. Returns
 * the matching ban or null. Lazy-expires before testing.
 *
 * `context` shape: { visitorId?, email?, visitorName, company? }
 */
export function matchActiveBan(context) {
  expireStaleBans();
  const { visitorId, email, visitorName, company } = context;

  // 1. By visitor record (most specific) — when we already resolved the
  // visitor record (typically because the sign-in supplied an email that
  // matched an existing visitor row).
  if (visitorId) {
    const r = db.prepare("SELECT * FROM visitor_bans WHERE active = 1 AND mode = 'visitor' AND visitor_id = ?")
      .get(visitorId);
    if (r) return rowToBan(r);
  }

  // 2. By-name fallback against any 'visitor' ban — catches the case where
  // the same person comes back WITHOUT an email this time but their typed
  // name + company match the banned visitor's record. Runs even when
  // visitorId is set (defence in depth: a ban-by-visitor + email change
  // shouldn't let them through if their visible identity is unchanged).
  if (visitorName) {
    const fallback = db.prepare(`
      SELECT b.*
      FROM visitor_bans b
      JOIN visitors v ON v.id = b.visitor_id
      WHERE b.active = 1 AND b.mode = 'visitor'
        AND LOWER(?) = LOWER(v.name)
        AND (v.company IS NULL OR ? IS NULL OR LOWER(?) = LOWER(v.company))
      LIMIT 1
    `).get(visitorName, company, company);
    if (fallback) return rowToBan(fallback);
  }

  // 3. By email.
  if (email) {
    const r = db.prepare(`
      SELECT * FROM visitor_bans
      WHERE active = 1 AND mode = 'email' AND LOWER(email) = LOWER(?)
    `).get(email);
    if (r) return rowToBan(r);
  }

  // 4. By name (+ optional company) substring, case-insensitive.
  if (visitorName) {
    const rows = db.prepare(`SELECT * FROM visitor_bans WHERE active = 1 AND mode = 'name'`).all();
    for (const r of rows) {
      const nameOk = String(visitorName).toLowerCase().includes(String(r.name_pattern).toLowerCase());
      if (!nameOk) continue;
      if (r.company_pattern) {
        const companyOk = company && String(company).toLowerCase().includes(String(r.company_pattern).toLowerCase());
        if (!companyOk) continue;
      }
      return rowToBan(r);
    }
  }

  return null;
}

/**
 * Flip any active ban with expires_at past now to inactive. Cheap; runs
 * every read path. Mirrors invitation lazy-expire — no scheduler needed.
 */
function expireStaleBans() {
  db.prepare(`
    UPDATE visitor_bans
       SET active = 0
     WHERE active = 1
       AND expires_at IS NOT NULL
       AND datetime(expires_at) < datetime('now')
  `).run();
}

function rowToBan(r) {
  const createdBy = r.created_by_user_id
    ? db.prepare('SELECT id, username, display_name FROM users WHERE id = ?').get(r.created_by_user_id)
    : null;
  const liftedBy = r.lifted_by_user_id
    ? db.prepare('SELECT id, username, display_name FROM users WHERE id = ?').get(r.lifted_by_user_id)
    : null;
  return {
    id: r.id,
    mode: r.mode,
    visitorId: r.visitor_id,
    email: r.email,
    namePattern: r.name_pattern,
    companyPattern: r.company_pattern,
    reason: r.reason,
    expiresAt: r.expires_at,
    active: Boolean(r.active),
    createdBy: createdBy ? { id: createdBy.id, username: createdBy.username, displayName: createdBy.display_name } : null,
    createdAt: r.created_at,
    liftedBy: liftedBy ? { id: liftedBy.id, username: liftedBy.username, displayName: liftedBy.display_name } : null,
    liftedAt: r.lifted_at,
    liftReason: r.lift_reason,
  };
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}
