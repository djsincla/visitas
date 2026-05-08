-- v1.1 — adds visits.public_token, used to key the public badge + photo
-- endpoints so they can't be enumerated by walking sequential visit ids.
--
-- Plain ALTER ADD COLUMN — no table rebuild this time. The earlier
-- migrations (002, 003, 005, 007) used the rebuild dance defensively;
-- nullable column adds with no FK / CHECK don't actually need it.

ALTER TABLE visits ADD COLUMN public_token TEXT;

-- Backfill existing rows. randomblob(32) gives 32 random bytes, hex()
-- turns them into 64 lowercase-hex chars (matching what the application
-- writes via crypto.randomBytes(32).toString('hex')).
UPDATE visits
   SET public_token = lower(hex(randomblob(32)))
 WHERE public_token IS NULL;

CREATE UNIQUE INDEX idx_visits_public_token ON visits(public_token);
