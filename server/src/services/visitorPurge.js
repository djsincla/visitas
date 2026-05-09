import { unlinkSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { db } from '../db/index.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { recordAudit } from './audit.js';

/**
 * GDPR Art. 17 right-to-be-forgotten purge for a single visitor.
 *
 * What this removes:
 *   - The visitors row
 *   - Visit rows linked by visitor_id OR by case-insensitive email match are
 *     scrubbed: visitor_name → '[purged]', company / email / phone →
 *     NULL, photo_path / fields_json reset; the row itself stays so the
 *     audit / fire-roster timestamp story isn't broken
 *   - All signature files + photo files referenced by those visits
 *   - Acknowledgment rows have signed_name + signature_path nulled
 *   - Pre-registration invitations matched by email get scrubbed
 *   - Notifications_log rows whose recipient matches the email get scrubbed
 *   - Visitor-mode bans referencing this visitor have their visitor_id
 *     nulled (the ban survives in the audit log; the link to the deleted
 *     subject is broken)
 *   - audit_log details for any affected visit are nulled, and any
 *     signin_blocked entry whose details.email matches gets details
 *     nulled too — the row + action + subject_id stay, the PII payload
 *     goes
 *
 * Returns: { visitorId, visitsScrubbed, acksScrubbed, invitationsScrubbed,
 *           notificationsLogScrubbed, bansUnlinked, photosDeleted, signaturesDeleted }.
 *
 * Atomic: wrapped in a single SQL transaction. File deletion happens
 * AFTER the transaction succeeds — if a file unlink fails, the DB is
 * already consistent and we just log the file leak (worst case: an
 * orphan file that the daily photo retention sweep eventually
 * notices for photos; signatures live forever otherwise).
 *
 * Idempotent: calling on an already-purged visitor returns zeros and
 * a 404. Caller surfaces 404.
 */
export function purgeVisitor({ visitorId, actorUserId, reason = null }) {
  if (!Number.isInteger(visitorId) || visitorId <= 0) {
    throw new Error('purgeVisitor requires a positive integer visitorId');
  }

  const visitor = db.prepare('SELECT id, name, email FROM visitors WHERE id = ?').get(visitorId);
  if (!visitor) return null;

  const emailLower = visitor.email ? visitor.email.toLowerCase() : null;

  // Collect file paths BEFORE we scrub the rows.
  const visitRows = db.prepare(`
    SELECT id, photo_path FROM visits
     WHERE visitor_id = ?
        OR (? IS NOT NULL AND LOWER(email) = ?)
  `).all(visitorId, emailLower, emailLower);

  const visitIds = visitRows.map(r => r.id);
  const photoPaths = visitRows.map(r => r.photo_path).filter(Boolean);

  let signaturePaths = [];
  if (visitIds.length) {
    const placeholders = visitIds.map(() => '?').join(',');
    signaturePaths = db.prepare(`
      SELECT signature_path FROM visit_acknowledgments
       WHERE visit_id IN (${placeholders}) AND signature_path IS NOT NULL
    `).all(...visitIds).map(r => r.signature_path);
  }

  // All DB scrubs happen in one transaction.
  const result = db.transaction(() => {
    let visitsScrubbed = 0;
    let acksScrubbed = 0;
    let invitationsScrubbed = 0;
    let notificationsLogScrubbed = 0;
    let bansUnlinked = 0;

    if (visitIds.length) {
      const placeholders = visitIds.map(() => '?').join(',');
      visitsScrubbed = db.prepare(`
        UPDATE visits
           SET visitor_name = '[purged]',
               company = NULL,
               email = NULL,
               phone = NULL,
               photo_path = NULL,
               fields_json = '{}',
               visitor_id = NULL
         WHERE id IN (${placeholders})
      `).run(...visitIds).changes;

      acksScrubbed = db.prepare(`
        UPDATE visit_acknowledgments
           SET signed_name = NULL,
               signature_path = NULL
         WHERE visit_id IN (${placeholders})
      `).run(...visitIds).changes;

      // Scrub audit_log details for any row about an affected visit.
      db.prepare(`
        UPDATE audit_log
           SET details = NULL
         WHERE subject_type = 'visit' AND subject_id IN (${placeholders})
      `).run(...visitIds);
    }

    if (emailLower) {
      invitationsScrubbed = db.prepare(`
        UPDATE prereg_invitations
           SET visitor_name = '[purged]',
               email = '[purged]',
               company = NULL,
               phone = NULL,
               purpose = NULL
         WHERE LOWER(email) = ?
      `).run(emailLower).changes;

      notificationsLogScrubbed = db.prepare(`
        UPDATE notifications_log
           SET recipient = '[purged]',
               subject = NULL,
               error = NULL
         WHERE LOWER(recipient) = ?
      `).run(emailLower).changes;

      // Scrub PII out of signin_blocked audit details that reference this email.
      // json_extract is available because better-sqlite3 ships with JSON1.
      db.prepare(`
        UPDATE audit_log
           SET details = NULL
         WHERE action = 'visit_signin_blocked'
           AND LOWER(json_extract(details, '$.email')) = ?
      `).run(emailLower);
    }

    bansUnlinked = db.prepare(`
      UPDATE visitor_bans
         SET visitor_id = NULL
       WHERE visitor_id = ?
    `).run(visitorId).changes;

    db.prepare('DELETE FROM visitors WHERE id = ?').run(visitorId);

    recordAudit({
      userId: actorUserId,
      action: 'visitor_purged',
      subjectType: 'visitor',
      subjectId: visitorId,
      details: {
        reason: reason || null,
        visitsScrubbed,
        acksScrubbed,
        invitationsScrubbed,
        notificationsLogScrubbed,
        bansUnlinked,
      },
    });

    return { visitsScrubbed, acksScrubbed, invitationsScrubbed, notificationsLogScrubbed, bansUnlinked };
  })();

  // File deletion happens after the transaction commits. A failure here
  // doesn't roll back the DB scrub — the worst case is an orphaned file.
  let photosDeleted = 0;
  let signaturesDeleted = 0;
  for (const rel of photoPaths) {
    const abs = resolve(config.dataDir, rel);
    if (existsSync(abs)) {
      try { unlinkSync(abs); photosDeleted++; }
      catch (err) { logger.warn({ err: err.message, file: abs }, 'photo unlink during purge failed'); }
    }
  }
  for (const rel of signaturePaths) {
    const abs = resolve(config.dataDir, rel);
    if (existsSync(abs)) {
      try { unlinkSync(abs); signaturesDeleted++; }
      catch (err) { logger.warn({ err: err.message, file: abs }, 'signature unlink during purge failed'); }
    }
  }

  return { visitorId, ...result, photosDeleted, signaturesDeleted };
}
