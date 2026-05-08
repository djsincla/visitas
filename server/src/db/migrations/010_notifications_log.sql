-- v1.3 — notifications log.
--
-- Every email + SMS dispatch lands a row here so operators have a debug
-- surface when the workshop says "Mike isn't getting his SMS." Status
-- transitions: pending → sent | failed (with error). Rows are kept
-- indefinitely for now; a retention sweep can be added in a later
-- migration if disk pressure becomes real.

CREATE TABLE notifications_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('email', 'sms')),
  event TEXT NOT NULL,                              -- e.g. 'signed_in', 'signin_blocked', 'visitor_nda_copy', 'test_email'
  recipient TEXT NOT NULL,                          -- email or phone
  subject TEXT,                                     -- email-only; null for SMS
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  error TEXT,                                       -- non-null when status='failed'
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT
);

CREATE INDEX idx_notifications_log_created ON notifications_log(created_at DESC);
CREATE INDEX idx_notifications_log_status  ON notifications_log(status);
CREATE INDEX idx_notifications_log_event   ON notifications_log(event);
