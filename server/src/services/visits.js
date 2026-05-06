import { db } from '../db/index.js';
import { recordAudit } from './audit.js';
import { notifyVisitEventAsync } from '../notifications/index.js';

const ACTIVE_SQL = `
  SELECT v.*, u.username AS host_username, u.display_name AS host_display_name
  FROM visits v
  LEFT JOIN users u ON u.id = v.host_user_id
`;

export function createVisit({ visitorName, company = null, email = null, phone = null, hostUserId, purpose = null, fields = {} }) {
  const host = db.prepare("SELECT id, role, active FROM users WHERE id = ?").get(hostUserId);
  if (!host) throw httpError(400, 'unknown host');
  if (host.role !== 'admin') throw httpError(400, 'host must be a host (role=admin), not a security user');
  if (!host.active) throw httpError(400, 'host is inactive');

  const info = db.prepare(`
    INSERT INTO visits (visitor_name, company, email, phone, host_user_id, purpose, fields_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    visitorName,
    company,
    email,
    phone,
    hostUserId,
    purpose,
    JSON.stringify(fields),
  );
  const visitId = Number(info.lastInsertRowid);
  recordAudit({
    action: 'visit_signed_in',
    subjectType: 'visit',
    subjectId: visitId,
    details: { hostUserId, source: 'kiosk' },
  });
  const visit = getById(visitId);
  notifyVisitEventAsync('signed_in', { visit });
  return visit;
}

export function signOutVisit({ visitId, byUserId = null, method }) {
  const v = db.prepare('SELECT id, status FROM visits WHERE id = ?').get(visitId);
  if (!v) throw httpError(404, 'visit not found');
  if (v.status !== 'on_site') throw httpError(409, 'visit already signed out');

  db.prepare(`
    UPDATE visits SET
      status = 'signed_out',
      signed_out_at = datetime('now'),
      signed_out_by_user_id = ?,
      signed_out_method = ?
    WHERE id = ?
  `).run(byUserId, method, visitId);

  recordAudit({
    userId: byUserId,
    action: method === 'admin' ? 'visit_force_signed_out' : 'visit_signed_out',
    subjectType: 'visit',
    subjectId: visitId,
    details: { method },
  });
  const visit = getById(visitId);
  let actor = null;
  if (byUserId) {
    actor = db.prepare('SELECT id, username, display_name, role FROM users WHERE id = ?').get(byUserId);
  }
  notifyVisitEventAsync(method === 'admin' ? 'force_signed_out' : 'signed_out', { visit, actor });
  return visit;
}

export function getById(visitId) {
  const r = db.prepare(`${ACTIVE_SQL} WHERE v.id = ?`).get(visitId);
  return r ? rowToVisit(r) : null;
}

export function listActive() {
  return db.prepare(`${ACTIVE_SQL} WHERE v.status = 'on_site' ORDER BY v.signed_in_at ASC`)
    .all().map(rowToVisit);
}

export function listAll({ status = null, limit = 200 } = {}) {
  let sql = ACTIVE_SQL;
  const params = [];
  if (status) { sql += ' WHERE v.status = ?'; params.push(status); }
  sql += ' ORDER BY v.signed_in_at DESC LIMIT ?';
  params.push(limit);
  return db.prepare(sql).all(...params).map(rowToVisit);
}

function rowToVisit(r) {
  return {
    id: r.id,
    visitorName: r.visitor_name,
    company: r.company,
    email: r.email,
    phone: r.phone,
    host: r.host_user_id ? {
      id: r.host_user_id,
      username: r.host_username,
      displayName: r.host_display_name,
    } : null,
    purpose: r.purpose,
    fields: r.fields_json ? JSON.parse(r.fields_json) : {},
    status: r.status,
    signedInAt: r.signed_in_at,
    signedOutAt: r.signed_out_at,
    signedOutBy: r.signed_out_by_user_id,
    signedOutMethod: r.signed_out_method,
  };
}

/** Sanitize for the public wall view — names + hosts + duration only. */
export function sanitizeForWall(v) {
  return {
    id: v.id,
    visitorName: v.visitorName,
    hostName: v.host?.displayName || v.host?.username || null,
    signedInAt: v.signedInAt,
  };
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}
