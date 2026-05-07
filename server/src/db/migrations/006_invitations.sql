-- v0.7 — pre-registration invitations.
--
-- Hosts pre-book expected visitors. Each invitation has a random unguessable
-- token that the visitor receives by email (with a QR code rendering the
-- kiosk URL + token). Scanning the QR with iOS Camera opens the kiosk URL
-- in Safari; the kiosk reads the token from the query string, pre-fills
-- the form, locks the host to the pre-booked one, and on submit marks
-- the invitation `used` + linked to the new visit.

CREATE TABLE prereg_invitations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  visitor_name TEXT NOT NULL,
  email TEXT NOT NULL,
  company TEXT,
  phone TEXT,
  host_user_id INTEGER NOT NULL,
  kiosk_id INTEGER,
  expected_at TEXT,
  purpose TEXT,
  status TEXT NOT NULL DEFAULT 'sent'
    CHECK (status IN ('sent', 'used', 'cancelled', 'expired')),
  created_by_user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  used_visit_id INTEGER,
  FOREIGN KEY(host_user_id) REFERENCES users(id),
  FOREIGN KEY(kiosk_id) REFERENCES kiosks(id),
  FOREIGN KEY(created_by_user_id) REFERENCES users(id),
  FOREIGN KEY(used_visit_id) REFERENCES visits(id)
);

CREATE INDEX idx_invitations_token ON prereg_invitations(token);
CREATE INDEX idx_invitations_status ON prereg_invitations(status);
CREATE INDEX idx_invitations_email ON prereg_invitations(LOWER(email));
CREATE INDEX idx_invitations_expires ON prereg_invitations(expires_at);
