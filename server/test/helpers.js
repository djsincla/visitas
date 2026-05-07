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
  // Visits and audit log first (FKs into users + kiosks). Settings + users
  // get wiped. Kiosks are *configuration* like cambiar's change_types — the
  // 'default' kiosk seeded on first migration is preserved across resets so
  // tests don't have to re-seed each one. Tests that mutate kiosks should
  // clean up after themselves.
  db.exec(`
    DELETE FROM visit_acknowledgments;
    DELETE FROM prereg_invitations;
    DELETE FROM visits;
    DELETE FROM visitors;
    DELETE FROM audit_log;
    DELETE FROM settings;
    DELETE FROM users;
    DELETE FROM documents;
    DELETE FROM kiosks WHERE slug != 'default';
    UPDATE kiosks SET active = 1, default_printer_name = NULL, name = 'Reception' WHERE slug = 'default';
  `);
  db.exec(`DELETE FROM sqlite_sequence WHERE name IN ('users', 'audit_log', 'visits', 'visitors', 'documents', 'visit_acknowledgments', 'prereg_invitations')`);

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

/** Logs in admin/admin, changes password, returns the agent — usable for both admin and security tests after createUser. */
export async function adminAgent() {
  const a = await agentFor('admin', 'admin');
  await a.post('/api/auth/change-password').send({ currentPassword: 'admin', newPassword: 'AAaa1234567' });
  return a;
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
