import { db } from '../db/index.js';

/**
 * Find a visitor by email (case-insensitive). Returns the row or null.
 * Email matching is case-insensitive but stored as the visitor most
 * recently typed it.
 */
export function findByEmail(email) {
  if (!email) return null;
  const r = db.prepare('SELECT * FROM visitors WHERE LOWER(email) = LOWER(?)').get(email);
  return r ? rowToVisitor(r) : null;
}

export function getById(id) {
  const r = db.prepare('SELECT * FROM visitors WHERE id = ?').get(id);
  return r ? rowToVisitor(r) : null;
}

/**
 * Find a visitor by email or create a new one. If an existing visitor is
 * found, refresh `last_seen_at` and update name/company/phone with whatever
 * the visitor most recently typed (people change companies, etc.).
 *
 * Returns { visitor, isReturning }.
 */
export function findOrCreateByEmail({ email, name, company = null, phone = null }) {
  const existing = email ? findByEmail(email) : null;
  if (existing) {
    db.prepare(`
      UPDATE visitors
         SET name = ?, company = COALESCE(?, company), phone = COALESCE(?, phone),
             email = COALESCE(?, email),
             last_seen_at = datetime('now')
       WHERE id = ?
    `).run(name, company, phone, email, existing.id);
    return { visitor: getById(existing.id), isReturning: true };
  }

  const info = db.prepare(`
    INSERT INTO visitors (name, company, email, phone)
    VALUES (?, ?, ?, ?)
  `).run(name, company, email, phone);
  return { visitor: getById(Number(info.lastInsertRowid)), isReturning: false };
}

/**
 * Lookup for the kiosk's pre-fill flow. Public endpoint behind this returns
 * sanitized fields plus an NDA cache state.
 *
 * Returns null if email isn't recognized.
 */
export function lookupForKiosk(email) {
  const v = findByEmail(email);
  if (!v) return null;
  const ndaCache = computeNdaCache(v.id);
  return {
    name: v.name,
    company: v.company,
    phone: v.phone,
    email: v.email,
    isReturning: true,
    ndaCacheFresh: ndaCache.fresh,
    ndaCacheVersion: ndaCache.version ?? null,
    ndaCacheAcknowledgedAt: ndaCache.acknowledgedAt ?? null,
  };
}

/**
 * Has this visitor acknowledged the *currently active* NDA within the last
 * 365 days? Returns { fresh, version, acknowledgedAt, documentId }.
 */
export function computeNdaCache(visitorId) {
  const activeNda = db.prepare("SELECT id, version FROM documents WHERE kind = 'nda' AND active = 1").get();
  if (!activeNda) return { fresh: false };

  const ack = db.prepare(`
    SELECT a.acknowledged_at, a.document_id
    FROM visit_acknowledgments a
    JOIN visits v ON v.id = a.visit_id
    WHERE v.visitor_id = ? AND a.document_id = ?
      AND datetime(a.acknowledged_at) >= datetime('now', '-365 days')
    ORDER BY a.acknowledged_at DESC
    LIMIT 1
  `).get(visitorId, activeNda.id);

  if (!ack) return { fresh: false };
  return {
    fresh: true,
    documentId: ack.document_id,
    version: activeNda.version,
    acknowledgedAt: ack.acknowledged_at,
  };
}

function rowToVisitor(r) {
  return {
    id: r.id,
    name: r.name,
    company: r.company,
    email: r.email,
    phone: r.phone,
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
  };
}

/**
 * Admin list view — every visitor we've ever seen with derived counts
 * and NDA cache status. Sorted most-recent-first.
 */
export function listForAdmin({ limit = 500 } = {}) {
  const rows = db.prepare(`
    SELECT v.*,
           (SELECT COUNT(*) FROM visits WHERE visitor_id = v.id) AS visit_count,
           (SELECT MAX(signed_in_at) FROM visits WHERE visitor_id = v.id) AS most_recent_visit_at
    FROM visitors v
    ORDER BY datetime(v.last_seen_at) DESC
    LIMIT ?
  `).all(limit);

  return rows.map(r => {
    const visitor = rowToVisitor(r);
    const cache = computeNdaCache(r.id);
    return {
      ...visitor,
      visitCount: r.visit_count,
      mostRecentVisitAt: r.most_recent_visit_at,
      ndaCacheFresh: cache.fresh,
      ndaCacheVersion: cache.version ?? null,
      ndaCacheAcknowledgedAt: cache.acknowledgedAt ?? null,
    };
  });
}
