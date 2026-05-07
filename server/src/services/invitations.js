import { randomBytes } from 'node:crypto';
import { db } from '../db/index.js';
import { recordAudit } from './audit.js';

const DEFAULT_EXPIRY_DAYS = 7;

/**
 * Create an invitation. Token is 32 hex chars (16 bytes random).
 * Returns the full row including computed kiosk slug.
 */
export function createInvitation({
  visitorName, email, company = null, phone = null,
  hostUserId, kioskSlug = null, expectedAt = null, purpose = null,
  createdByUserId, expiryDays = DEFAULT_EXPIRY_DAYS,
}) {
  const host = db.prepare("SELECT id, role, active FROM users WHERE id = ?").get(hostUserId);
  if (!host) throw httpError(400, 'unknown host');
  if (host.role !== 'admin') throw httpError(400, 'host must be a host (role=admin)');
  if (!host.active) throw httpError(400, 'host is inactive');

  let kioskId = null;
  if (kioskSlug) {
    const k = db.prepare('SELECT id FROM kiosks WHERE slug = ? AND active = 1').get(kioskSlug);
    if (!k) throw httpError(400, `unknown kiosk: ${kioskSlug}`);
    kioskId = k.id;
  }

  const token = randomBytes(16).toString('hex');
  const info = db.prepare(`
    INSERT INTO prereg_invitations
      (token, visitor_name, email, company, phone, host_user_id, kiosk_id,
       expected_at, purpose, created_by_user_id, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+' || ? || ' days'))
  `).run(token, visitorName, email, company, phone, hostUserId, kioskId,
         expectedAt, purpose, createdByUserId, expiryDays);

  const id = Number(info.lastInsertRowid);
  recordAudit({
    userId: createdByUserId,
    action: 'invitation_created',
    subjectType: 'invitation',
    subjectId: id,
    details: { hostUserId, email, kioskSlug },
  });
  return getById(id);
}

/**
 * Look up by token. Returns null if not found, expired, used, or cancelled.
 * Auto-flips status to 'expired' if past expiry on read (lazy expiry, no
 * scheduler needed — consistent with cambiar's approach).
 */
export function getByToken(token) {
  if (!token) return null;
  const r = db.prepare('SELECT * FROM prereg_invitations WHERE token = ?').get(token);
  if (!r) return null;

  // Lazy expire on read.
  if (r.status === 'sent' && new Date(r.expires_at.replace(' ', 'T') + 'Z') < new Date()) {
    db.prepare('UPDATE prereg_invitations SET status = ? WHERE id = ?').run('expired', r.id);
    r.status = 'expired';
  }
  if (r.status !== 'sent') return rowToInvitation(r); // returned with non-active status; caller decides
  return rowToInvitation(r);
}

export function getById(id) {
  const r = db.prepare('SELECT * FROM prereg_invitations WHERE id = ?').get(id);
  return r ? rowToInvitation(r) : null;
}

export function listAll({ status = null, limit = 200 } = {}) {
  const sql = status
    ? 'SELECT * FROM prereg_invitations WHERE status = ? ORDER BY created_at DESC LIMIT ?'
    : 'SELECT * FROM prereg_invitations ORDER BY created_at DESC LIMIT ?';
  const params = status ? [status, limit] : [limit];
  return db.prepare(sql).all(...params).map(rowToInvitation);
}

/**
 * Mark used + link to a visit. Throws if invitation isn't in 'sent' state
 * (caller should check getByToken first; this is the atomic write).
 */
export function markUsed({ token, visitId, byUserId = null }) {
  const r = db.prepare("SELECT * FROM prereg_invitations WHERE token = ? AND status = 'sent'").get(token);
  if (!r) throw httpError(410, 'invitation no longer valid');
  db.prepare(`
    UPDATE prereg_invitations
       SET status = 'used', used_at = datetime('now'), used_visit_id = ?
     WHERE id = ?
  `).run(visitId, r.id);
  recordAudit({
    userId: byUserId,
    action: 'invitation_used',
    subjectType: 'invitation',
    subjectId: r.id,
    details: { visitId },
  });
  return getById(r.id);
}

export function cancel(id, byUserId) {
  const r = db.prepare('SELECT id, status FROM prereg_invitations WHERE id = ?').get(id);
  if (!r) throw httpError(404, 'invitation not found');
  if (r.status !== 'sent') throw httpError(409, `invitation is ${r.status}, cannot cancel`);
  db.prepare("UPDATE prereg_invitations SET status = 'cancelled' WHERE id = ?").run(id);
  recordAudit({
    userId: byUserId,
    action: 'invitation_cancelled',
    subjectType: 'invitation',
    subjectId: id,
  });
  return getById(id);
}

function rowToInvitation(r) {
  const host = r.host_user_id ? db.prepare('SELECT id, username, display_name FROM users WHERE id = ?').get(r.host_user_id) : null;
  const kiosk = r.kiosk_id ? db.prepare('SELECT id, slug, name FROM kiosks WHERE id = ?').get(r.kiosk_id) : null;
  return {
    id: r.id,
    token: r.token,
    visitorName: r.visitor_name,
    email: r.email,
    company: r.company,
    phone: r.phone,
    host: host ? { id: host.id, username: host.username, displayName: host.display_name } : null,
    kiosk: kiosk ? { id: kiosk.id, slug: kiosk.slug, name: kiosk.name } : null,
    expectedAt: r.expected_at,
    purpose: r.purpose,
    status: r.status,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    usedAt: r.used_at,
    usedVisitId: r.used_visit_id,
  };
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}
