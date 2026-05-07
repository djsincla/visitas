-- @no-tx
-- v0.4 — multi-kiosk support.
--
-- Each iPad-driven sign-in surface is a kiosk identified by URL slug
-- (/kiosk/{slug}). Each kiosk records its display name and a default printer
-- name (used as a hint on the badge page; MDM enforces the actual AirPrint
-- default at the iOS level).
--
-- Adding visits.kiosk_id is a CHECK-bearing-table column add — SQLite can
-- ALTER TABLE ADD COLUMN with a FK in modern versions, but to keep the
-- migration uniform with 002 we run a table-rebuild for visits as well.

PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

CREATE TABLE kiosks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  default_printer_name TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_kiosks_active ON kiosks(active);

-- Seed the 'default' kiosk so /kiosk (no slug) keeps working for single-iPad
-- workshops that don't bother with multi-kiosk.
INSERT INTO kiosks (slug, name, default_printer_name)
VALUES ('default', 'Reception', NULL);

-- Rebuild visits with the new kiosk_id column.
CREATE TABLE visits_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visitor_name TEXT NOT NULL,
  company TEXT,
  email TEXT,
  phone TEXT,
  host_user_id INTEGER NOT NULL,
  purpose TEXT,
  fields_json TEXT NOT NULL DEFAULT '{}',
  kiosk_id INTEGER,
  status TEXT NOT NULL DEFAULT 'on_site' CHECK (status IN ('on_site', 'signed_out')),
  signed_in_at TEXT NOT NULL DEFAULT (datetime('now')),
  signed_out_at TEXT,
  signed_out_by_user_id INTEGER,
  signed_out_method TEXT CHECK (signed_out_method IN ('kiosk', 'admin')),
  FOREIGN KEY(host_user_id) REFERENCES users(id),
  FOREIGN KEY(signed_out_by_user_id) REFERENCES users(id),
  FOREIGN KEY(kiosk_id) REFERENCES kiosks(id)
);

INSERT INTO visits_new (id, visitor_name, company, email, phone, host_user_id, purpose, fields_json, status, signed_in_at, signed_out_at, signed_out_by_user_id, signed_out_method)
SELECT id, visitor_name, company, email, phone, host_user_id, purpose, fields_json, status, signed_in_at, signed_out_at, signed_out_by_user_id, signed_out_method
FROM visits;

-- Backfill kiosk_id for existing visits → 'default' kiosk so historical rows aren't orphaned.
UPDATE visits_new SET kiosk_id = (SELECT id FROM kiosks WHERE slug = 'default');

DROP TABLE visits;
ALTER TABLE visits_new RENAME TO visits;

CREATE INDEX idx_visits_status ON visits(status);
CREATE INDEX idx_visits_signed_in ON visits(signed_in_at);
CREATE INDEX idx_visits_host ON visits(host_user_id);
CREATE INDEX idx_visits_kiosk ON visits(kiosk_id);

COMMIT;

PRAGMA foreign_keys = ON;
