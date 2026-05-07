-- @no-tx
-- v0.6 — first-class visitor records.
--
-- Visitors are keyed by email when the visitor provides one. The unique
-- index is partial (only enforced on non-NULL emails) so anonymous visitors
-- without an email can still sign in — they just don't get the
-- returning-visitor pre-fill or NDA-cache benefits.
--
-- The visits table gets a nullable visitor_id FK. Backfill links each
-- existing visit with an email to a visitor record (lower-cased email
-- equality, since people retype their address with different casing).

PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

CREATE TABLE visitors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  company TEXT,
  email TEXT,
  phone TEXT,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Case-insensitive uniqueness on non-null email.
CREATE UNIQUE INDEX idx_visitors_email_unique ON visitors(LOWER(email)) WHERE email IS NOT NULL;
CREATE INDEX idx_visitors_last_seen ON visitors(last_seen_at);

-- Add visitor_id to visits (table rebuild).
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

INSERT INTO visits_new (id, visitor_name, company, email, phone, host_user_id, purpose, fields_json, kiosk_id, status, signed_in_at, signed_out_at, signed_out_by_user_id, signed_out_method)
SELECT id, visitor_name, company, email, phone, host_user_id, purpose, fields_json, kiosk_id, status, signed_in_at, signed_out_at, signed_out_by_user_id, signed_out_method
FROM visits;

DROP TABLE visits;
ALTER TABLE visits_new RENAME TO visits;

CREATE INDEX idx_visits_status ON visits(status);
CREATE INDEX idx_visits_signed_in ON visits(signed_in_at);
CREATE INDEX idx_visits_host ON visits(host_user_id);
CREATE INDEX idx_visits_kiosk ON visits(kiosk_id);
CREATE INDEX idx_visits_visitor ON visits(visitor_id);

-- Backfill: for each existing visit with an email, find-or-create a visitor.
-- We use the earliest visit's name/company/phone as the visitor's seed data;
-- subsequent visits update last_seen_at only.
INSERT INTO visitors (name, company, email, phone, first_seen_at, last_seen_at)
SELECT
  visitor_name AS name,
  MAX(company) AS company,
  email,
  MAX(phone) AS phone,
  MIN(signed_in_at) AS first_seen_at,
  MAX(signed_in_at) AS last_seen_at
FROM visits
WHERE email IS NOT NULL AND email != ''
GROUP BY LOWER(email)
ORDER BY MIN(signed_in_at);

UPDATE visits
SET visitor_id = (
  SELECT id FROM visitors WHERE LOWER(visitors.email) = LOWER(visits.email)
)
WHERE email IS NOT NULL AND email != '';

COMMIT;

PRAGMA foreign_keys = ON;
