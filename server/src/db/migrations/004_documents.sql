-- v0.5 — admin-editable, versioned NDA + safety briefing documents,
-- and a per-visit acknowledgment record (with optional signature PNG path
-- for the NDA, no signature for safety briefings).
--
-- Each save bumps the version: the previous active row for that kind is
-- flipped to active=0 and a new row is inserted. This is enforced in the
-- service layer because we need application-level version numbering;
-- a partial unique index keeps the data sound at the DB level too.

CREATE TABLE documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('nda', 'safety')),
  version INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (kind, version)
);

-- Only one active row per kind at a time.
CREATE UNIQUE INDEX idx_documents_one_active_per_kind ON documents(kind) WHERE active = 1;
CREATE INDEX idx_documents_kind_version ON documents(kind, version DESC);

CREATE TABLE visit_acknowledgments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visit_id INTEGER NOT NULL,
  document_id INTEGER NOT NULL,
  signed_name TEXT,
  signature_path TEXT,
  acknowledged_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(visit_id) REFERENCES visits(id) ON DELETE CASCADE,
  FOREIGN KEY(document_id) REFERENCES documents(id)
);

CREATE INDEX idx_visit_acks_visit ON visit_acknowledgments(visit_id);
CREATE INDEX idx_visit_acks_document ON visit_acknowledgments(document_id);
