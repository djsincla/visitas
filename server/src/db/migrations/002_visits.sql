-- @no-tx
-- v0.2 — visits table + widen users.role to include 'security'.
--
-- The role widening is a CHECK-constraint change, which SQLite can't ALTER
-- in place, so we rebuild the users table. foreign_keys is toggled OFF for
-- the rebuild because audit_log already FKs into users(id) and the rebuild
-- involves a DROP. PRAGMA foreign_keys can't be set inside a transaction,
-- hence the @no-tx marker that opts out of the runner's wrapping.

PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

-- Rebuild users with the widened role enum.
CREATE TABLE users_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  email TEXT,
  display_name TEXT,
  password_hash TEXT,
  source TEXT NOT NULL DEFAULT 'local' CHECK (source IN ('local', 'ad')),
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'security')),
  must_change_password INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  phone TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO users_new (id, username, email, display_name, password_hash, source, role, must_change_password, active, phone, created_at, updated_at)
SELECT id, username, email, display_name, password_hash, source, role, must_change_password, active, phone, created_at, updated_at
FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

-- The visit record. Visitors are not users — they're tracked here only.
-- host_user_id points to the user (must be role=admin) the visitor is here
-- to see. signed_out_method records whether the visitor signed themselves
-- out at the kiosk or whether an admin/security user force-signed them out.
CREATE TABLE visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visitor_name TEXT NOT NULL,
  company TEXT,
  email TEXT,
  phone TEXT,
  host_user_id INTEGER NOT NULL,
  purpose TEXT,
  fields_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'on_site' CHECK (status IN ('on_site', 'signed_out')),
  signed_in_at TEXT NOT NULL DEFAULT (datetime('now')),
  signed_out_at TEXT,
  signed_out_by_user_id INTEGER,
  signed_out_method TEXT CHECK (signed_out_method IN ('kiosk', 'admin')),
  FOREIGN KEY(host_user_id) REFERENCES users(id),
  FOREIGN KEY(signed_out_by_user_id) REFERENCES users(id)
);

CREATE INDEX idx_visits_status ON visits(status);
CREATE INDEX idx_visits_signed_in ON visits(signed_in_at);
CREATE INDEX idx_visits_host ON visits(host_user_id);

COMMIT;

PRAGMA foreign_keys = ON;
