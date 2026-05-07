import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcrypt';
import { db } from './index.js';
import { logger } from '../logger.js';
import { config } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function runMigrations() {
  db.exec(`CREATE TABLE IF NOT EXISTS migrations (
    id TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  );`);

  const dir = resolve(__dirname, 'migrations');
  const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  const applied = new Set(db.prepare('SELECT id FROM migrations').all().map(r => r.id));

  for (const file of files) {
    if (applied.has(file)) continue;
    logger.info({ file }, 'applying migration');
    const sql = readFileSync(resolve(dir, file), 'utf8');

    // Migrations that need to manage their own transactions can opt out of the
    // runner's wrapper by starting with `-- @no-tx`.
    if (/^\s*--\s*@no-tx/m.test(sql)) {
      db.exec(sql);
      db.prepare('INSERT INTO migrations (id) VALUES (?)').run(file);
    } else {
      const tx = db.transaction(() => {
        db.exec(sql);
        db.prepare('INSERT INTO migrations (id) VALUES (?)').run(file);
      });
      tx();
    }
  }
}

export function bootstrapAdmin() {
  const existing = db.prepare("SELECT id FROM users WHERE username = 'admin'").get();
  if (existing) return false;

  const hash = bcrypt.hashSync('admin', 12);
  db.prepare(`
    INSERT INTO users (username, display_name, password_hash, source, role, must_change_password)
    VALUES (?, ?, ?, 'local', 'admin', 1)
  `).run('admin', 'Administrator', hash);

  logger.warn('Bootstrap admin created: username=admin password=admin (change on first login)');
  return true;
}

/**
 * Seed documents (NDA + safety) from config/visitor-form.json on first run.
 * Once any documents row exists for that kind, the DB is authoritative and
 * the seed is a no-op for that kind.
 */
export function seedDocumentsFromConfig() {
  const path = resolve(config.repoRoot, 'config/visitor-form.json');
  if (!existsSync(path)) return false;

  let cfg;
  try { cfg = JSON.parse(readFileSync(path, 'utf8')); }
  catch (e) { logger.warn({ err: e.message }, 'visitor-form.json unparseable; skipping seed'); return false; }

  let seeded = 0;
  for (const kind of ['nda', 'safety']) {
    const block = cfg[kind];
    if (!block || !block.body) continue;
    const exists = db.prepare('SELECT 1 FROM documents WHERE kind = ?').get(kind);
    if (exists) continue;
    db.prepare(`
      INSERT INTO documents (kind, version, title, body, active)
      VALUES (?, 1, ?, ?, ?)
    `).run(kind, block.title || (kind === 'nda' ? 'Visitor non-disclosure agreement' : 'Workshop safety briefing'), block.body, block.enabled ? 1 : 0);
    seeded++;
  }
  if (seeded) logger.info({ seeded }, 'seeded documents from visitor-form.json');
  return seeded > 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations();
  bootstrapAdmin();
  seedDocumentsFromConfig();
  logger.info('migrations complete');
  process.exit(0);
}
