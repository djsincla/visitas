import { db } from '../db/index.js';

/**
 * Notifications log — every email + SMS dispatch attempt lands here.
 *
 * Lifecycle: caller calls `createPending` *before* the transport runs and
 * gets back an id. On success, `markSent(id)`. On failure (caught
 * exception), `markFailed(id, error)`. The log is the operator's only
 * window into delivery health when SMTP / Twilio is misbehaving.
 */

export function createPending({ kind, event, recipient, subject = null }) {
  const info = db.prepare(`
    INSERT INTO notifications_log (kind, event, recipient, subject, status)
    VALUES (?, ?, ?, ?, 'pending')
  `).run(kind, event, recipient, subject);
  return Number(info.lastInsertRowid);
}

export function markSent(id) {
  db.prepare(`
    UPDATE notifications_log
       SET status = 'sent', sent_at = datetime('now')
     WHERE id = ?
  `).run(id);
}

export function markFailed(id, error) {
  db.prepare(`
    UPDATE notifications_log
       SET status = 'failed', error = ?, sent_at = datetime('now')
     WHERE id = ?
  `).run(String(error?.message ?? error ?? 'unknown error').slice(0, 1024), id);
}

export function listRecent({ limit = 100, status = null, event = null } = {}) {
  const where = [];
  const params = [];
  if (status) { where.push('status = ?'); params.push(status); }
  if (event)  { where.push('event = ?');  params.push(event); }
  const sql = `
    SELECT * FROM notifications_log
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY id DESC LIMIT ?
  `;
  params.push(limit);
  return db.prepare(sql).all(...params).map(rowToEntry);
}

function rowToEntry(r) {
  return {
    id: r.id,
    kind: r.kind,
    event: r.event,
    recipient: r.recipient,
    subject: r.subject,
    status: r.status,
    error: r.error,
    createdAt: r.created_at,
    sentAt: r.sent_at,
  };
}
