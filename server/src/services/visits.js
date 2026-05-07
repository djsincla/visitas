import { db } from '../db/index.js';
import { recordAudit } from './audit.js';
import { notifyVisitEventAsync } from '../notifications/index.js';

const VISIT_SQL = `
  SELECT v.*,
         u.username AS host_username, u.display_name AS host_display_name,
         k.slug AS kiosk_slug, k.name AS kiosk_name,
         k.default_printer_name AS kiosk_printer
  FROM visits v
  LEFT JOIN users u ON u.id = v.host_user_id
  LEFT JOIN kiosks k ON k.id = v.kiosk_id
`;

export function createVisit({ visitorName, company = null, email = null, phone = null, hostUserId, purpose = null, fields = {}, kioskSlug = null }) {
  const host = db.prepare("SELECT id, role, active FROM users WHERE id = ?").get(hostUserId);
  if (!host) throw httpError(400, 'unknown host');
  if (host.role !== 'admin') throw httpError(400, 'host must be a host (role=admin), not a security user');
  if (!host.active) throw httpError(400, 'host is inactive');

  let kioskId = null;
  if (kioskSlug) {
    const k = db.prepare('SELECT id, active FROM kiosks WHERE slug = ?').get(kioskSlug);
    if (!k) throw httpError(400, `unknown kiosk: ${kioskSlug}`);
    if (!k.active) throw httpError(400, `kiosk ${kioskSlug} is inactive`);
    kioskId = k.id;
  } else {
    // No kiosk specified — fall back to 'default' if it exists.
    const fallback = db.prepare("SELECT id FROM kiosks WHERE slug = 'default' AND active = 1").get();
    if (fallback) kioskId = fallback.id;
  }

  const info = db.prepare(`
    INSERT INTO visits (visitor_name, company, email, phone, host_user_id, purpose, fields_json, kiosk_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    visitorName,
    company,
    email,
    phone,
    hostUserId,
    purpose,
    JSON.stringify(fields),
    kioskId,
  );
  const visitId = Number(info.lastInsertRowid);
  recordAudit({
    action: 'visit_signed_in',
    subjectType: 'visit',
    subjectId: visitId,
    details: { hostUserId, kioskId, source: 'kiosk' },
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
  const r = db.prepare(`${VISIT_SQL} WHERE v.id = ?`).get(visitId);
  return r ? rowToVisit(r) : null;
}

export function listActive({ kioskSlug = null } = {}) {
  let sql = `${VISIT_SQL} WHERE v.status = 'on_site'`;
  const params = [];
  if (kioskSlug) { sql += ' AND k.slug = ?'; params.push(kioskSlug); }
  sql += ' ORDER BY v.signed_in_at ASC';
  return db.prepare(sql).all(...params).map(rowToVisit);
}

export function listAll({ status = null, kioskSlug = null, limit = 200 } = {}) {
  let sql = VISIT_SQL;
  const where = [];
  const params = [];
  if (status)     { where.push('v.status = ?');  params.push(status); }
  if (kioskSlug)  { where.push('k.slug = ?');    params.push(kioskSlug); }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
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
    kiosk: r.kiosk_id ? {
      id: r.kiosk_id,
      slug: r.kiosk_slug,
      name: r.kiosk_name,
      defaultPrinterName: r.kiosk_printer,
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

/** Sanitize for the public wall view — names + hosts + kiosk + duration only. */
export function sanitizeForWall(v) {
  return {
    id: v.id,
    visitorName: v.visitorName,
    hostName: v.host?.displayName || v.host?.username || null,
    kioskName: v.kiosk?.name || null,
    kioskSlug: v.kiosk?.slug || null,
    signedInAt: v.signedInAt,
  };
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}
