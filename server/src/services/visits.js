import { randomBytes } from 'node:crypto';
import { db } from '../db/index.js';
import { recordAudit } from './audit.js';
import { notifyVisitEventAsync } from '../notifications/index.js';
import { getActive as getActiveDoc } from './documents.js';
import { recordAcknowledgment, loadAcknowledgmentsForVisit } from './visitAcknowledgments.js';
import { sendVisitorNdaCopy } from '../notifications/visitorNda.js';
import { findOrCreateByEmail, computeNdaCache } from './visitors.js';
import { getByToken as getInvitation, markUsed as markInvitationUsed } from './invitations.js';
import { storePhoto, photoEnabled } from './photo.js';

const VISIT_SQL = `
  SELECT v.*,
         u.username AS host_username, u.display_name AS host_display_name,
         k.slug AS kiosk_slug, k.name AS kiosk_name,
         k.default_printer_name AS kiosk_printer,
         vr.id AS visitor_record_id, vr.email AS visitor_email
  FROM visits v
  LEFT JOIN users u ON u.id = v.host_user_id
  LEFT JOIN kiosks k ON k.id = v.kiosk_id
  LEFT JOIN visitors vr ON vr.id = v.visitor_id
`;

export function createVisit({
  visitorName, company = null, email = null, phone = null,
  hostUserId, purpose = null, fields = {}, kioskSlug = null,
  acknowledgments = [], inviteToken = null, photoPngBase64 = null,
}) {
  let invitation = null;
  if (inviteToken) {
    invitation = getInvitation(inviteToken);
    if (!invitation) throw httpError(404, 'invitation not found');
    if (invitation.status !== 'sent') throw httpError(410, `invitation ${invitation.status}`);
    hostUserId = invitation.host.id;
    if (invitation.kiosk) kioskSlug = invitation.kiosk.slug;
    if (!email) email = invitation.email;
  }

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
    const fallback = db.prepare("SELECT id FROM kiosks WHERE slug = 'default' AND active = 1").get();
    if (fallback) kioskId = fallback.id;
  }

  // Look up or create the visitor record (when email present). 1-year NDA
  // cache: a returning visitor with a recent ack of the *current active*
  // NDA can skip the NDA acknowledgment for this visit.
  let visitorRow = null;
  let ndaCacheHit = null;
  if (email) {
    const r = findOrCreateByEmail({ email, name: visitorName, company, phone });
    visitorRow = r.visitor;
    if (r.isReturning) {
      const cache = computeNdaCache(visitorRow.id);
      if (cache.fresh) ndaCacheHit = cache;
    }
  }

  // Validate acknowledgments BEFORE inserting the visit so we don't end up
  // with a visit row missing required NDA / safety records. The caller
  // (route layer) supplies acknowledgments[] = [{kind, signedName?, signaturePngBase64?}].
  const requiredKinds = [];
  for (const kind of ['nda', 'safety']) {
    const doc = getActiveDoc(kind);
    if (doc) requiredKinds.push({ kind, doc });
  }
  for (const { kind } of requiredKinds) {
    // Skip NDA requirement when the visitor has a fresh cache hit.
    if (kind === 'nda' && ndaCacheHit) continue;
    const provided = acknowledgments.find(a => a.kind === kind);
    if (!provided) throw httpError(400, `acknowledgment required: ${kind}`);
    if (kind === 'nda' && !provided.signaturePngBase64) {
      throw httpError(400, 'NDA signature required');
    }
  }

  // 64-hex random token used to key public badge + photo URLs so they
  // can't be enumerated by walking sequential ids. Match the format the
  // backfill in 008_public_token.sql produced.
  const publicToken = randomBytes(32).toString('hex');

  const info = db.prepare(`
    INSERT INTO visits (visitor_name, company, email, phone, host_user_id, purpose, fields_json, kiosk_id, visitor_id, public_token)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    visitorName,
    company,
    email,
    phone,
    hostUserId,
    purpose,
    JSON.stringify(fields),
    kioskId,
    visitorRow?.id ?? null,
    publicToken,
  );
  const visitId = Number(info.lastInsertRowid);

  // Persist acknowledgment rows + signature files. NDA is skipped when cache hit.
  let ndaSignaturePath = null;
  let ndaDoc = null;
  for (const { kind, doc } of requiredKinds) {
    if (kind === 'nda' && ndaCacheHit) continue;
    const ack = acknowledgments.find(a => a.kind === kind);
    const row = recordAcknowledgment({
      visitId,
      documentId: doc.id,
      kind,
      signedName: ack?.signedName ?? visitorName,
      signaturePngBase64: ack?.signaturePngBase64 ?? null,
    });
    if (kind === 'nda') { ndaSignaturePath = row.signature_path; ndaDoc = doc; }
  }

  if (invitation) {
    markInvitationUsed({ token: inviteToken, visitId });
  }

  // Photo capture (opt-in via settings.photo.enabled). Silently ignore
  // photoPngBase64 when the channel is disabled. Magic-byte rejection
  // (assertPng inside storePhoto) propagates as 400 to the client so a
  // hostile request with non-PNG bytes gets a clear refusal.
  if (photoEnabled() && photoPngBase64) {
    storePhoto({ visitId, photoPngBase64 });
  }

  recordAudit({
    action: 'visit_signed_in',
    subjectType: 'visit',
    subjectId: visitId,
    details: {
      hostUserId,
      kioskId,
      visitorId: visitorRow?.id ?? null,
      invitationId: invitation?.id ?? null,
      source: invitation ? 'invitation' : 'kiosk',
      acknowledgments: requiredKinds.map(r => ({
        kind: r.kind,
        version: r.doc.version,
        cached: r.kind === 'nda' && !!ndaCacheHit,
      })),
      ndaCacheHit: ndaCacheHit ? {
        version: ndaCacheHit.version,
        acknowledgedAt: ndaCacheHit.acknowledgedAt,
      } : null,
    },
  });
  const visit = getById(visitId);
  notifyVisitEventAsync('signed_in', { visit });

  // Best-effort: if NDA was signed and the visitor gave an email, mail them
  // a copy with the signature inline. Failure logs but doesn't block.
  if (ndaDoc && visit.email) {
    setImmediate(() => {
      sendVisitorNdaCopy({
        visit,
        document: ndaDoc,
        signaturePath: ndaSignaturePath,
        signedAt: visit.signedInAt,
      }).catch(() => {});
    });
  }

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
  if (!r) return null;
  const v = rowToVisit(r);
  v.acknowledgments = loadAcknowledgmentsForVisit(visitId);
  return v;
}

/** Look up by the public token. Used by the unauth'd badge + photo routes. */
export function getByPublicToken(token) {
  if (!token) return null;
  const r = db.prepare(`${VISIT_SQL} WHERE v.public_token = ?`).get(token);
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
    visitor: r.visitor_id ? {
      id: r.visitor_id,
      email: r.visitor_email,
    } : null,
    photoPath: r.photo_path ?? null,
    publicToken: r.public_token ?? null,
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
