import bcrypt from 'bcrypt';
import request from 'supertest';
import { db } from '../src/db/index.js';
import { createApp } from '../src/app.js';

let _app;
export function getApp() {
  if (!_app) _app = createApp({ httpLogger: false });
  return _app;
}

/**
 * Wipe all data and reseed a known fixture set.
 * Order matters because of FK constraints.
 */
export function resetDb() {
  db.exec(`
    DELETE FROM audit_log;
    DELETE FROM settings;
    DELETE FROM users;
  `);
  db.exec(`DELETE FROM sqlite_sequence WHERE name IN ('users', 'audit_log')`);

  // Bootstrap admin (admin/admin, must change password) — same as runtime bootstrap.
  const hash = bcrypt.hashSync('admin', 4);
  db.prepare(`
    INSERT INTO users (username, display_name, password_hash, source, role, must_change_password)
    VALUES ('admin', 'Administrator', ?, 'local', 'admin', 1)
  `).run(hash);
}

/**
 * Create a local user with the given attrs. Returns { id, username, password (plain) }.
 * Uses a low bcrypt cost factor for speed; tests are not security-critical.
 */
export function createUser({
  username,
  password = 'TestPass1234',
  email = null,
  displayName = null,
  role = 'admin',
  active = 1,
  mustChangePassword = 0,
  phone = null,
} = {}) {
  if (!username) throw new Error('username required');
  const hash = bcrypt.hashSync(password, 4);
  const info = db.prepare(`
    INSERT INTO users (username, email, display_name, password_hash, source, role, active, must_change_password, phone)
    VALUES (?, ?, ?, ?, 'local', ?, ?, ?, ?)
  `).run(username, email, displayName, hash, role, active, mustChangePassword, phone);
  return { id: Number(info.lastInsertRowid), username, password };
}

export async function agentFor(username, password) {
  const agent = request.agent(getApp());
  const res = await agent.post('/api/auth/login').send({ username, password });
  if (res.status !== 200) {
    throw new Error(`login failed for ${username}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return agent;
}

export function client() {
  return request(getApp());
}

export function row(sql, ...params) {
  return db.prepare(sql).get(...params);
}

export function rows(sql, ...params) {
  return db.prepare(sql).all(...params);
}
