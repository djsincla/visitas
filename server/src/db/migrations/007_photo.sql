-- @no-tx
-- v0.8 — adds visits.photo_path for opt-in front-camera capture.
--
-- Same table-rebuild dance as 002 / 003 / 005 since SQLite can't ALTER a
-- CHECK-bearing or FK-bearing table to add a column without a rebuild.

PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

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
  visitor_id INTEGER,
  photo_path TEXT,
  status TEXT NOT NULL DEFAULT 'on_site' CHECK (status IN ('on_site', 'signed_out')),
  signed_in_at TEXT NOT NULL DEFAULT (datetime('now')),
  signed_out_at TEXT,
  signed_out_by_user_id INTEGER,
  signed_out_method TEXT CHECK (signed_out_method IN ('kiosk', 'admin')),
  FOREIGN KEY(host_user_id) REFERENCES users(id),
  FOREIGN KEY(signed_out_by_user_id) REFERENCES users(id),
  FOREIGN KEY(kiosk_id) REFERENCES kiosks(id),
  FOREIGN KEY(visitor_id) REFERENCES visitors(id)
);

INSERT INTO visits_new (id, visitor_name, company, email, phone, host_user_id, purpose, fields_json, kiosk_id, visitor_id, status, signed_in_at, signed_out_at, signed_out_by_user_id, signed_out_method)
SELECT id, visitor_name, company, email, phone, host_user_id, purpose, fields_json, kiosk_id, visitor_id, status, signed_in_at, signed_out_at, signed_out_by_user_id, signed_out_method
FROM visits;

DROP TABLE visits;
ALTER TABLE visits_new RENAME TO visits;

CREATE INDEX idx_visits_status ON visits(status);
CREATE INDEX idx_visits_signed_in ON visits(signed_in_at);
CREATE INDEX idx_visits_host ON visits(host_user_id);
CREATE INDEX idx_visits_kiosk ON visits(kiosk_id);
CREATE INDEX idx_visits_visitor ON visits(visitor_id);
CREATE INDEX idx_visits_photo_purge ON visits(signed_in_at) WHERE photo_path IS NOT NULL;

COMMIT;

PRAGMA foreign_keys = ON;
