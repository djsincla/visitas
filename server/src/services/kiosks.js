import { db } from '../db/index.js';

export function listKiosks({ activeOnly = false } = {}) {
  const sql = activeOnly
    ? 'SELECT * FROM kiosks WHERE active = 1 ORDER BY name COLLATE NOCASE'
    : 'SELECT * FROM kiosks ORDER BY active DESC, name COLLATE NOCASE';
  return db.prepare(sql).all().map(rowToKiosk);
}

export function getKioskBySlug(slug) {
  const r = db.prepare('SELECT * FROM kiosks WHERE slug = ?').get(slug);
  return r ? rowToKiosk(r) : null;
}

export function getKioskById(id) {
  const r = db.prepare('SELECT * FROM kiosks WHERE id = ?').get(id);
  return r ? rowToKiosk(r) : null;
}

export function createKiosk({ slug, name, defaultPrinterName = null }) {
  if (!/^[a-z0-9-]+$/.test(slug)) throw httpError(400, 'slug must be lowercase letters, numbers, dashes only');
  const exists = db.prepare('SELECT 1 FROM kiosks WHERE slug = ?').get(slug);
  if (exists) throw httpError(409, 'kiosk slug already taken');

  const info = db.prepare(`
    INSERT INTO kiosks (slug, name, default_printer_name)
    VALUES (?, ?, ?)
  `).run(slug, name, defaultPrinterName);
  return getKioskById(Number(info.lastInsertRowid));
}

export function patchKiosk(slug, patch) {
  const k = db.prepare('SELECT id FROM kiosks WHERE slug = ?').get(slug);
  if (!k) throw httpError(404, 'kiosk not found');

  const fields = [];
  const values = [];
  if ('name' in patch)                { fields.push('name = ?');                   values.push(patch.name); }
  if ('defaultPrinterName' in patch)  { fields.push('default_printer_name = ?');   values.push(patch.defaultPrinterName ?? null); }
  if ('active' in patch)              { fields.push('active = ?');                 values.push(patch.active ? 1 : 0); }
  if (!fields.length) return getKioskById(k.id);

  fields.push("updated_at = datetime('now')");
  db.prepare(`UPDATE kiosks SET ${fields.join(', ')} WHERE id = ?`).run(...values, k.id);
  return getKioskById(k.id);
}

export function deactivateKiosk(slug) {
  if (slug === 'default') throw httpError(409, 'cannot deactivate the default kiosk');
  return patchKiosk(slug, { active: false });
}

function rowToKiosk(r) {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    defaultPrinterName: r.default_printer_name,
    active: Boolean(r.active),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}
