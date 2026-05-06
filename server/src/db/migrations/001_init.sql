-- v0.1 — base schema for visitas.world.
--
-- Hosts and administrators are the same population: anyone with a user record
-- here can both log in to the admin UI and be selected as the host of a visit.
-- Visitors themselves are NOT users — they're tracked in a separate visits
-- table introduced in a later migration once the kiosk sign-in flow lands.

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  email TEXT,
  display_name TEXT,
  password_hash TEXT,
  source TEXT NOT NULL DEFAULT 'local' CHECK (source IN ('local', 'ad')),
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin')),
  must_change_password INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  phone TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  subject_type TEXT,
  subject_id INTEGER,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_subject ON audit_log(subject_type, subject_id);
