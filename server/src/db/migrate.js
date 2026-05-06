import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcrypt';
import { db } from './index.js';
import { logger } from '../logger.js';

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

if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations();
  bootstrapAdmin();
  logger.info('migrations complete');
  process.exit(0);
}
