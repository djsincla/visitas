import { db } from '../db/index.js';

export function recordAudit({ userId = null, action, subjectType = null, subjectId = null, details = null }) {
  db.prepare(`
    INSERT INTO audit_log (user_id, action, subject_type, subject_id, details)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    userId,
    action,
    subjectType,
    subjectId,
    details ? JSON.stringify(details) : null,
  );
}

export function loadAudit({ subjectType, subjectId, limit = 100 } = {}) {
  let sql = `
    SELECT a.*, u.username AS user_username, u.display_name AS user_display_name
    FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
  `;
  const params = [];
  if (subjectType) {
    sql += ' WHERE a.subject_type = ? AND a.subject_id = ?';
    params.push(subjectType, subjectId);
  }
  sql += ' ORDER BY a.id DESC LIMIT ?';
  params.push(limit);

  return db.prepare(sql).all(...params).map(r => ({
    id: r.id,
    action: r.action,
    subjectType: r.subject_type,
    subjectId: r.subject_id,
    details: r.details ? JSON.parse(r.details) : null,
    user: r.user_username ? { id: r.user_id, username: r.user_username, displayName: r.user_display_name } : null,
    createdAt: r.created_at,
  }));
}
