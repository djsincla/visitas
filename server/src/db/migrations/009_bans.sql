-- v1.2 — visitor bans / denylist.
--
-- Three match modes:
--   'visitor' — banned by visitor record (any future signin attempt that
--               resolves to this visitor record by email is blocked, AND
--               by-name fallback if visit.email is missing but visitor_name
--               and company match the banned visitor's name + company).
--   'email'   — banned by raw email (case-insensitive). Useful before the
--               person ever signs in (and so has no visitor record yet).
--   'name'    — banned by name pattern + optional company pattern. The
--               last-resort match for emailless walk-ins. Each pattern is
--               a case-insensitive substring match against the visit's
--               visitor_name / company fields.
--
-- expires_at NULL = permanent. Lazy-expired on read by the service layer.

CREATE TABLE visitor_bans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mode TEXT NOT NULL CHECK (mode IN ('visitor', 'email', 'name')),
  visitor_id INTEGER,
  email TEXT,
  name_pattern TEXT,
  company_pattern TEXT,
  reason TEXT NOT NULL,
  expires_at TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_by_user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  lifted_by_user_id INTEGER,
  lifted_at TEXT,
  lift_reason TEXT,
  FOREIGN KEY(visitor_id) REFERENCES visitors(id),
  FOREIGN KEY(created_by_user_id) REFERENCES users(id),
  FOREIGN KEY(lifted_by_user_id) REFERENCES users(id)
);

-- Active-only indexes for the hot read path (matchActiveBan).
CREATE INDEX idx_bans_active_visitor ON visitor_bans(visitor_id) WHERE active = 1;
CREATE INDEX idx_bans_active_email   ON visitor_bans(LOWER(email)) WHERE active = 1;
CREATE INDEX idx_bans_active_name    ON visitor_bans(LOWER(name_pattern)) WHERE active = 1;
CREATE INDEX idx_bans_expires        ON visitor_bans(expires_at) WHERE active = 1 AND expires_at IS NOT NULL;
