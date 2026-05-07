import { db } from '../db/index.js';

/**
 * Documents are versioned per kind. Each save bumps version and flips the
 * previous active row inactive. Pulled together transactionally so the
 * partial unique index never sees two active rows.
 */

export function listAll({ kind = null } = {}) {
  const sql = kind
    ? 'SELECT * FROM documents WHERE kind = ? ORDER BY version DESC'
    : 'SELECT * FROM documents ORDER BY kind, version DESC';
  const params = kind ? [kind] : [];
  return db.prepare(sql).all(...params).map(rowToDoc);
}

export function getActive(kind) {
  const r = db.prepare('SELECT * FROM documents WHERE kind = ? AND active = 1').get(kind);
  return r ? rowToDoc(r) : null;
}

export function getActiveAll() {
  const rows = db.prepare("SELECT * FROM documents WHERE active = 1 ORDER BY kind").all();
  return rows.map(rowToDoc);
}

export function getById(id) {
  const r = db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
  return r ? rowToDoc(r) : null;
}

/**
 * Save a new version of a document. If body and title are unchanged from the
 * current active row, returns the existing one without bumping (no churn).
 * Otherwise transactionally deactivates the previous active and inserts a
 * fresh row at version+1.
 */
export function saveDocument({ kind, title, body }) {
  if (!['nda', 'safety'].includes(kind)) throw httpError(400, 'invalid kind');

  const current = getActive(kind);
  if (current && current.title === title && current.body === body) {
    return current;
  }
  const nextVersion = current ? current.version + 1 : 1;

  const tx = db.transaction(() => {
    if (current) {
      db.prepare('UPDATE documents SET active = 0 WHERE id = ?').run(current.id);
    }
    const info = db.prepare(`
      INSERT INTO documents (kind, version, title, body, active)
      VALUES (?, ?, ?, ?, 1)
    `).run(kind, nextVersion, title, body);
    return info.lastInsertRowid;
  });
  const id = Number(tx());
  return getById(id);
}

/** Mark the active document for a kind as inactive (visitor flow stops requiring it). */
export function deactivate(kind) {
  const current = getActive(kind);
  if (!current) return null;
  db.prepare('UPDATE documents SET active = 0 WHERE id = ?').run(current.id);
  return getById(current.id);
}

function rowToDoc(r) {
  return {
    id: r.id,
    kind: r.kind,
    version: r.version,
    title: r.title,
    body: r.body,
    active: Boolean(r.active),
    createdAt: r.created_at,
  };
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}
