# Changelog

All notable changes to visitas.world are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses semantic versioning.

## [1.4.0] — 2026-05-08

Security pass &mdash; the rest of the v1.0 review. Tightens the session
cookie&rsquo;s `SameSite` attribute, refuses to start with an enabled-but-
unauthenticated AD config, and confirms (via existing tests) that the PNG
magic-byte check covers signatures as well as photos. No new surface; this
is hardening.

### Changed
- **Session cookie is now `SameSite=Strict`** instead of `Lax`. Closes
  any latent CSRF gap that a future GET-with-side-effects endpoint
  could open. Trade-off: an admin clicking an `/admin/...` link from
  outside the SPA (e.g. an email) will hit the page logged-out and
  need to sign in &mdash; fair price for a LAN-only app.
- **AD configuration is validated at startup** (`assertAdBindCredentials`).
  When `auth.ad.enabled = true` and `auth.ad.bindDN` is set but
  `AD_BIND_PASSWORD` env is empty, the server logs a fatal error and
  exits with code 1. Previously it would silently fall back to an
  anonymous bind, which on most LDAP servers can succeed and return
  wrong-looking results &mdash; a corner case that would silently
  misauthenticate users. The same check also runs inside
  `authenticateAD` as defense in depth (so CLI tools and tests that
  bypass startup still hit it).

### Verified (already in code from v1.1)
- PNG magic-byte (`89 50 4E 47 0D 0A 1A 0A`) is enforced on **both**
  the photo and signature paths via `assertPng()` in
  `services/photo.js` and `services/visitAcknowledgments.js`.
  Regression tests live in `test/photo.test.js` and
  `test/documents.test.js`.

### Tests
- `test/auth.test.js` &mdash; new assertion that the session cookie
  carries `HttpOnly` + `SameSite=Strict`.
- `test/ad.test.js` &mdash; four new tests around
  `assertAdBindCredentials` (no-op when disabled, no-op when bindDN
  unset, throws when enabled with empty password, passes when
  password is present), plus a defense-in-depth case showing
  `authenticateAD` itself surfaces 503 when the bind password is empty.

## [1.3.0] — 2026-05-08

Operational hardening pass. Four small-but-load-bearing improvements that
came out of the v1.0 senior-developer code review and that we want in
place before iPad trial: a notifications failure log so missing
host-emails are debuggable, a configurable photo retention window so
workshops with strict privacy needs can shorten the default 30 days, an
admins-only mode for the `/active` wall view for sites with sensitive
client work, and a single `npm run preflight` script that runs everything
CI runs.

### Added
- **Migration 010**: `notifications_log` table — every email + SMS dispatch
  attempt writes a row with status `pending` → `sent` | `failed` plus the
  transport error message on failure. Indexed by created\_at, status, and
  event. `email.js`, `sms.js`, and `invitationEmail.js` were threaded
  through the pending → sent | failed lifecycle so the operator finally has
  a debug surface when the workshop says &ldquo;Mike isn&rsquo;t getting
  his SMS.&rdquo;
- **`GET /api/notifications-log`** (admin only) — recent dispatch attempts
  with optional `?status=` and `?event=` filters, default limit 100.
  Surfaced in the admin Settings page as a &ldquo;Notifications log&rdquo;
  panel that auto-refreshes every 60 seconds.
- **Configurable photo retention** — `setting:photo.retention_days` (default
  30, range 1&ndash;365). The daily sweep reads the setting on every run, so
  changes take effect at the next sweep without restart. Admin Settings page
  has a &ldquo;Photo retention&rdquo; section to edit it.
- **Wall-view privacy toggle** — `setting:wall_view.public` (default true).
  When flipped to false, `GET /api/visits/active` requires an admin or
  security session cookie. The web wall view at `/active` shows a
  friendly &ldquo;Sign-in required&rdquo; message in that mode instead of
  failing silently. Workshops that host clients with NDA-sensitive
  presence flip this off.
- **`npm run preflight`** — root script that runs `npm test`, `npm run
  build`, and `npm run test:e2e` in sequence. Mirrors what CI runs;
  intended for &ldquo;before push&rdquo;.

### Changed
- `services/photo.js > purgeExpiredPhotos` reads retention from
  settings each call instead of using a module-level `RETENTION_DAYS`
  constant. Consuming code unchanged; default behavior unchanged.
- `notifications/index.js` (host notifications) and the
  `signin_blocked` dispatcher now pass `event` through to `sendEmail` /
  `sendSms` so log rows are tagged with a meaningful event name.

### Notes
- Notifications log rows are kept indefinitely for now &mdash; a sweep
  can be added later if disk pressure becomes real (it won&rsquo;t for
  small workshops at single-digit visits per day).
- Wall-view auth is intentionally session-cookie based, not
  token-keyed: workshops that need the hallway-iPad use case AND
  privacy can either keep it public or park a long-lived security
  session on the wall iPad. A signed-URL alternative is a v1.4 option
  if the trade-off bites.

## [1.2.0] — 2026-05-08

Visitor bans / denylist. Admins and security users on the floor can now
ban a visitor — by visitor record (most specific), by email
(case-insensitive exact), or by name + optional company (substring). When
a banned visitor tries to sign in, the kiosk refuses with a generic
&ldquo;Sign-in not permitted, please see reception&rdquo; (the reason is
never shown to the visitor, only kept for the audit log + admin UI), and
all on-duty admin + security users get an email + SMS so reception can
intercept the visitor at the door.

### Added
- **Migration 009**: `visitor_bans` table with three match modes
  (`visitor` / `email` / `name`), required `reason`, optional `expires_at`
  (lazy-expired on read like invitations), and full audit fields
  (`created_by_user_id`, `lifted_by_user_id`, `lifted_at`, `lift_reason`).
- **`services/bans.js`** — `createBan`, `liftBan`, `listAll`,
  `matchActiveBan(context)`. Match logic is intentionally layered: visitor-
  by-id is most specific, then by-name fallback (so a banned-by-record
  visitor who comes back without an email is still caught if their name
  + company match the banned visitor record), then by-email exact, then
  by-name + optional company substring.
- **`POST /api/bans`** + **`GET /api/bans`** + **`POST /api/bans/:id/lift`**
  — admin **and security** can both manage bans. Security is on the floor
  and most likely to make the call.
- **Visit-creation ban gate** in `services/visits.js > createVisit`. Runs
  *before* the visit row is inserted; blocked attempts get a 403 with a
  generic message, an `audit_log` row with action `visit_signin_blocked`
  + the matched ban id, and a fire-and-forget `signin_blocked` notification
  to all active admin + security users (email + SMS, per-channel events
  filter respected). Bans beat invitations: a pre-registered visitor on
  the deny list is still refused, and the invitation is **not** marked
  used.
- **Admin Bans page** at `/admin/bans` — visible to admin and security.
  Lists active bans by default; toggle to include lifted/expired. Each
  row has a Lift control with a free-form reason.
- **Ban modal** (`web/src/components/BanModal.jsx`) — shared by the
  Bans page (manual create), the Visitors page (per-row Ban button), and
  the Active Visitors page (Ban alongside Force sign out). Pre-fills
  intelligently from whatever record opened it; admin can flip the
  match mode.
- **`signin_blocked` notification event** in `notifications/index.js`.
  Fires email + SMS to all active admin + security users with a body
  that names the visitor + company + email + intended host + ban
  reason, so reception knows who to intercept.
- **Topbar gains `Bans` link** for both admin and security roles.

### Internal
- 185 → 203 vitest server tests covering: ban service CRUD + lazy-expire
  + lift transitions; match logic per mode (email, name, name+company,
  visitor-by-id, by-name fallback); visit-creation 403 + audit row +
  invitation not-marked-used; admin AND security can both manage bans
  via the API.
- New `.modal-backdrop` + `.modal` styles in `web/src/styles.css` for
  the shared modal pattern (BanModal is the first user; future modals
  will reuse).

## [1.1.0] — 2026-05-07

Security pass. Three findings from the 1.0.1 code review, all fixed:
**(1)** the public badge + photo endpoints were keyed on sequential visit
ids, so anyone on the LAN could enumerate them and scrape every visitor's
photo + name + host; **(2)** PNG uploads (signature, photo) had no
magic-byte validation, so a hostile request could land arbitrary binary
on disk with a `.png` extension; **(3)** `/api/auth/login` had no rate
limit, so the bcrypt-12 cost was the only brake on a brute-force.

### Changed (security — minor breaking)
- **`/api/visits/:id/badge` and `/api/visits/:id/photo` are gone.**
  Replaced by `/api/visits/badge/:token` and `/api/visits/photo/:token`,
  where `:token` is a 64-hex random string in the visit row. The kiosk
  receives the token in the `POST /api/visits` response (`visit.publicToken`)
  and uses it to construct the print + reprint URLs. External integrations
  built against the old paths must be updated; visit ids alone no longer
  fetch badges or photos.
- **`POST /api/auth/login` is rate-limited** to 10 requests / minute / IP.
  429 with structured error body when over. Skipped under
  `NODE_ENV=test`. Same limit on `POST /api/visits/:id/sign-out` to
  prevent enumeration-driven mass sign-out as a denial-of-service.
- **PNG payloads now validated.** Decoded buffers must start with the
  PNG magic signature (`89 50 4E 47 0D 0A 1A 0A`); a 400 with `invalid
  signature PNG` / `invalid photo PNG` is returned otherwise. Applied to
  the NDA-signature path (`services/visitAcknowledgments.js`) and the
  visitor-photo path (`services/photo.js`). Centralized in `services/png.js`.

### Added
- **Migration 008**: `visits.public_token` (64-hex unique). Plain
  `ALTER TABLE ADD COLUMN`, no table-rebuild dance — that approach was
  defensive overkill for the 002–007 nullable adds; using it correctly
  here as a guidepost for future migrations (review item #20).
- **`Cache-Control: private, no-store`** on the token-keyed badge + photo
  responses so intermediate caches don't accidentally serve them.

### Internal
- New dependency: `express-rate-limit`.
- Sanitized wall-view payload (`/api/visits/active`) was already free of
  the public token — re-verified post-change. Tokens never appear in any
  list endpoint; only on the create response and inside the kiosk's
  reprint link.
- 182 → 185 vitest server tests covering: token route success +
  unenumerable-by-id, magic-byte rejection on photo + signature paths,
  visit payload includes `publicToken`. The rate-limit smoke is implicit —
  the existing suite (which fires lots of logins back-to-back) now
  exercises the `skip: NODE_ENV === 'test'` opt-out and stays green.

### Migration notes for operators
- No action needed: existing visits get a token via the migration's
  `lower(hex(randomblob(32)))` backfill.
- If you've embedded `/api/visits/:id/badge` URLs anywhere outside the
  kiosk (e.g. a custom integration), they'll 401 after upgrade. Switch
  to `/api/visits/badge/:token` and pull the token from the visit
  payload.

## [1.0.1] — 2026-05-07

CI green, no behavior change.

### Fixed
- **Admin form labels were not associated with their inputs.** Login,
  ChangePassword, Users (new user), Kiosks (new kiosk), and Invitations
  (new invitation) all rendered `<label>Foo</label><input>` as siblings
  with no `for=`/`id=` linking. That's an accessibility violation and
  Playwright's `getByLabel` can't match it — which is why every e2e spec
  going through `/login` timed out on `getByLabel('Username')` despite
  the heading being visible. Local vitest never caught it; the e2e CI
  runs were getting cancelled by the next push (`cancel-in-progress`)
  so 1.0.0 was the first run that completed and surfaced the failure.
  Added `htmlFor={id}` + matching `id={id}` to every label/input pair
  in the affected forms.

### Changed
- **Bumped CI + Dockerfile to Node 24** to retire the GitHub Actions
  Node 20 deprecation warnings. `actions/checkout@v5`,
  `actions/setup-node@v5` (with `node-version: 24`),
  `actions/upload-artifact@v5`. Multi-stage Dockerfile now uses
  `node:24-bookworm-slim` for build + runtime stages. `engines.node`
  in the package.json files stays at `>=20` so operators on existing
  Node 20 hosts can still run the server directly outside Docker.

## [1.0.0] — 2026-05-06

First stable release. Promotes `main` from the v0 development track to a
supported `1.0` line. No new features in this release — the entire v0
roadmap (kiosk sign-in, active visitors + wall view, security role, host
notifications, multi-iPad, AirPrint badges, NDA + safety with drawn
signature, returning-visitor pre-fill with 1-year NDA cache, Light/Dark/Auto
theme, admin Visitors + Invitations + Documents pages, pre-registration via
QR, opt-in photo capture with 30-day retention, AD host lookup) shipped
across v0.1 → v0.9 and is what 1.0 packages up.

182 vitest server tests + Playwright role-driven specs + Docker build run on
every push. The container deploys with `docker compose up -d --build`. See
the [README](README.md) for operator setup including the HTTPS guide for
production iPads (camera capture requires TLS).

### What 1.0 means
- The HTTP API surface in [API reference](README.md#api-reference-v09) is
  considered the contract. Backwards-incompatible changes after 1.0 will
  warrant a major bump and a deprecation note in the CHANGELOG.
- The migration sequence (`server/src/db/migrations/001_init.sql` through
  `007_photo.sql`) is final for the 1.x line. Future migrations append.
- `config/auth.json`, `config/notifications.json`, and
  `config/visitor-form.json` are stable shapes — additive changes only,
  unknown fields ignored.

### Internal
- `package.json` × 3 + `server/src/app.js` health/endpoint-index strings
  bumped to `1.0.0`. Tagged `v1.0.0` on the commit.

## [0.9.0] — 2026-05-06

Active Directory lookup. Workshop staff in the configured AD group
(`visitas-world`) can log in with their AD credentials and become hosts
in the kiosk's typeahead. Off by default; flip `auth.ad.enabled` in
`config/auth.json` and supply the bind password via the `AD_BIND_PASSWORD`
env var. Local accounts still work — bootstrap admin keeps you unlocked
even if AD is unreachable.

This closes the v0 roadmap. All eight feature releases (kiosk + multi-iPad
+ host notifications + AirPrint badges + NDA/safety + visitor records +
1-year NDA cache + pre-registration + photo capture + AD) are shipped.

### Added
- **`config/auth.json`** — full auth config now lives here. `local.enabled` +
  `local.passwordMinLength`, plus the new `ad` block: `enabled`, `url`,
  `bindDN`, `searchBase`, `searchFilter` (defaults to
  `(&(objectCategory=person)(objectClass=user)(sAMAccountName={username}))`
  to exclude machine accounts per the workshop's spec), `tlsRejectUnauthorized`,
  `allowedGroup` (default `visitas-world`), `attributes`. Default ships
  AD disabled.
- **`server/src/auth/ad.js`** — `ldapts`-driven LDAP client. `authenticateAD`
  does service-bind → search → user-rebind → group-allowlist check, returns
  `{ username, email, displayName, groups[] }` or null. `userInAllowedGroup`
  does case-insensitive substring match against `memberOf` DNs. Includes a
  `setClientFactoryForTests` seam so tests don't need a real LDAP server.
- **Login fallback to AD** — `routes/auth.js` tries local first (bootstrap
  admin always works, local-takes-precedence on collisions), falls through
  to AD when the local match fails or the user isn't local. AD users get an
  upserted `users` row with `source='ad'`, `role='admin'`, no
  `password_hash`, with `email` + `display_name` refreshed from AD on every
  login.
- **AD users in the host typeahead** — once an AD user has logged in once,
  they appear in `/api/hosts` (active `role=admin` users), so they can be
  selected as a host at the kiosk. New AD hires need to log in once to
  register; the README documents this flow.

### Internal
- 173 → 182 vitest server tests covering: AD user in `visitas-world` group
  succeeds + upserts as `source='ad'`, AD user not in group rejected,
  returning AD user has email/displayName refreshed, AD disabled =
  local-only, local-takes-precedence on username collision, bad AD
  password (rebind fails) returns 401, AD-upserted user appears in
  `/api/hosts` after login, `userInAllowedGroup` substring matching.

## [0.8.0] — 2026-05-06

Photo capture (opt-in). When the workshop turns it on, the kiosk asks each
visitor for a photo via the iPad's front camera; the photo prints on the
badge and is retained against the visit record for 30 days, then auto-purged.
Off by default — privacy is opt-in.

### Added
- **Migration 007** adds `visits.photo_path` (nullable, relative path under
  `data/`) via the same table-rebuild pattern as 002/003/005. Includes a
  partial index `(signed_in_at) WHERE photo_path IS NOT NULL` so the
  retention sweep is cheap.
- **`services/photo.js`** — `storePhoto({visitId, photoPngBase64})` writes
  to `data/photos/visit-{id}.png`, `photoFileFor(visitId)` resolves the
  on-disk path (or null after purge), `purgeExpiredPhotos()` deletes files
  older than 30d + nulls the column, `startPhotoRetentionSweep()` runs the
  purge once on startup and then every 24 h.
- **`POST /api/visits` accepts `photoPngBase64`** (5 MB cap, opt-in gated by
  `settings.photo.enabled` — silently ignored when disabled).
- **`GET /api/visits/:id/photo`** (public) serves the PNG when present, 404
  otherwise (after purge or for visits where no photo was captured).
- **Badge template** includes the photo as a 28×28 mm right-floated image
  on the badge when present.
- **Settings → Photo capture** toggle (admin only). Defaults off; clear
  copy on retention + HTTPS-or-localhost requirement for camera access.
- **Kiosk Photo stage** — `<PhotoCapture>` component using `getUserMedia`
  with the front-facing camera, mirrored preview (so the captured image
  matches what the visitor sees), Take photo / Retake / Use this photo
  flow. Inserted between form and safety briefing in the multi-stage flow
  when `settings.photo.enabled`.

### Internal
- 164 → 173 vitest server tests covering: opt-in gating (disabled = ignored,
  enabled = stored), file written to disk, public endpoint returns the PNG,
  404 when missing, retention sweep deletes >30d files + nulls column,
  retention sweep keeps fresh visits, admin-only toggle, security-role refused.
- `index.js` boot sequence now also calls `startPhotoRetentionSweep()` so
  long-running deployments stay within the 30-day window without a cron.

## [0.7.0] — 2026-05-06

Pre-registration. Hosts pre-book expected visitors via the new Invitations
admin page; visitas emails the invitee a link with an inline QR code. On
arrival the visitor scans the QR with their phone (or opens the link on
the iPad), the kiosk reads the invitation, pre-fills the form, and locks
the host to the pre-booked one. Single-use, 7-day expiry by default.

### Added
- **`prereg_invitations` table** with token UNIQUE, host_user_id FK,
  optional kiosk_id FK (lock invitation to a specific entrance),
  status check ('sent'|'used'|'cancelled'|'expired'), expires_at default
  +7d, used_at + used_visit_id linkage. Migration 006.
- **`services/invitations.js`** — `createInvitation` (32-hex token via
  `crypto.randomBytes`), `getByToken` (lazy-expires past `expires_at`),
  `markUsed`, `cancel`, `listAll`. Audit rows on every state transition.
- **`POST /api/invitations`** (admin), **`GET /api/invitations`** (admin),
  **`DELETE /api/invitations/:id`** (admin cancel),
  **`POST /api/invitations/:id/resend`** (admin), and
  **`GET /api/invitations/:token`** (public) for the kiosk to look up an
  invitation by token (returns 410 for expired/used/cancelled).
- **`POST /api/visits` accepts optional `inviteToken`** — when set, server
  ignores any client-supplied `hostUserId` and locks host (and kiosk, if
  the invitation pinned one) to the invitation, marks the invitation
  `used`, and links it to the new visit. Audit `details.invitationId` +
  `details.source: 'invitation'`.
- **Invitation email** with HTML body + inline QR code (server-side
  rendering via the `qrcode` package, embedded as a CID attachment so it
  shows in the email client). Subject `[visitas.world] Invitation to
  visit — {host}`. Best-effort send; SMTP failure is logged but does
  not fail the invitation creation.
- **Admin Invitations page** at `/admin/invitations` — form (visitor
  name + email + company + phone + host + optional kiosk + expected /
  purpose) plus a list grouped by status with **Copy link**, **Resend**,
  **Cancel** actions.
- **Kiosk `?invite=token` flow** — Kiosk reads `invite` from URL on
  mount, fetches `/api/invitations/{token}`, pre-fills the form, shows a
  "You were expected" banner with host + expected time, and locks the
  host field with a pre-booked badge. Invalid / expired tokens surface
  a friendly fallback inviting the visitor to sign in normally.

### Internal
- New dependency: `qrcode` (server-side QR rendering for invitation emails).
- 148 → 164 vitest server tests covering: invitation create + token
  format + expiry, host validation, security-role refused, public lookup
  with sanitized payload, lazy-expire on read, cancel transitions,
  visit-with-token locks host + marks used, used-token rejected with 410.
- `notifications/invitationEmail.js` mirrors the existing
  `visitorNda.js` test-seam pattern (`setInvitationSenderForTests`).
  Tests bypass QR rendering + nodemailer entirely so they don't need
  network or filesystem.

## [0.6.1] — 2026-05-06

Admin Visitors page. Every visitor the kiosk has ever signed in is listed
with derived visit count + NDA cache status, sorted most-recent-first.
Useful before v0.7's pre-registration flow lands; also a faster way to
spot a visitor whose NDA needs re-signing because the version bumped.

### Added
- `GET /api/visitors` (admin) — list every visitor with name, email,
  company, phone, first/last seen, visit count, and NDA cache status
  (`ndaCacheFresh`, `ndaCacheVersion`, `ndaCacheAcknowledgedAt`).
- `services/visitors.js > listForAdmin` — sorted by `last_seen_at` DESC,
  derives counts via correlated subquery, computes NDA cache per row.
- `/admin/visitors` web page with topbar nav link (admin only).
  Relative-time "last seen" display.
- 145 → 148 vitest server tests covering the admin list endpoint
  (auth required, security refused, derived counts + cache flags).

## [0.6.0] — 2026-05-06

Returning visitors don't have to start over. Visitors are now first-class
records keyed by email; a returning visitor types their email and the kiosk
pre-fills name / company / phone from their last visit. If they signed the
**current** active NDA in the last 365 days, the kiosk also skips the NDA +
signature step on this visit. New version of the NDA = everyone re-signs.

Email is **optional** at the kiosk — visitors without an email still sign in
just fine; they just don't get the pre-fill or the NDA cache benefit.

### Added
- **`visitors` table** keyed by email (case-insensitive partial unique index
  on non-NULL email), with `name`, `company`, `phone`, `first_seen_at`,
  `last_seen_at`. Visits get a nullable `visitor_id` FK. Migration 005
  back-fills existing visits to their visitor records on first apply
  (groups by `LOWER(email)`, uses earliest visit's metadata for seed,
  most-recent timestamp for `last_seen_at`).
- **`POST /api/visitors/lookup`** (public, kiosk-facing) — `{email}` →
  `{visitor: {name, company, phone, email, isReturning, ndaCacheFresh,
  ndaCacheVersion, ndaCacheAcknowledgedAt}}` or 404. Used by the kiosk's
  email-onBlur to fetch returning-visitor details.
- **`services/visitors.js`** — `findByEmail`, `findOrCreateByEmail` (case-
  insensitive lookup; creates on miss, refreshes `last_seen_at` and updates
  name/company/phone with what the visitor most recently typed),
  `lookupForKiosk`, `computeNdaCache`.
- **1-year NDA cache** — `services/visits.js > createVisit` looks up the
  visitor by email; if found AND the visitor has a `visit_acknowledgment`
  for the *currently active* NDA's `document_id` within the last 365 days,
  the NDA acknowledgment + signature requirement is skipped for this visit.
  Audit row records `ndaCacheHit: {version, acknowledgedAt}` and tags each
  acknowledgment with `cached: true|false`.
- **Kiosk web — returning-visitor pre-fill** — typing an email on the form
  fires `/api/visitors/lookup` on blur; on hit, the form pre-fills any
  fields the visitor hasn't already typed into and shows a "welcome back"
  banner with the cached NDA notice when applicable.
- **Kiosk web — NDA stage skip** — when the lookup says `ndaCacheFresh`,
  the multi-stage flow excludes the NDA step. Server still re-validates
  on submit (defense in depth). The thanks card mentions "Your NDA is on
  file from a previous visit" instead of the standard email-copy notice.

### Changed
- The visit payload from `GET /api/visits/:id` and create now includes
  `visitor: { id, email }` when the visit is linked to a visitor record.
- Audit detail shape on `visit_signed_in` extended with `visitorId` and
  `ndaCacheHit`. Existing assertions on the `acknowledgments` array now
  include the `cached` field (always `false` when the row was actually
  written; only the cache-hit code path sets `cached: true`).

### Internal
- Migration 005 (table-rebuild dance for `visits` to add `visitor_id` FK,
  `@no-tx` so `PRAGMA foreign_keys` can be toggled around the rebuild;
  back-fill is a `INSERT INTO visitors SELECT … FROM visits GROUP BY
  LOWER(email)` followed by a correlated `UPDATE visits SET visitor_id`).
- 128 → 145 vitest server tests covering: visitor service CRUD + case-
  insensitive lookup + last-seen refresh, NDA cache fresh/stale/missing/
  version-bump-invalidates/over-365-days-stale, lookup endpoint
  (404/200/case-insensitive), visit creation linking visitor_id, NDA cache
  hit short-circuiting acknowledgment requirement, audit details, returning
  visitor reusing visitor_id across visits, emailless visit visitor_id=null.

## [0.5.1] — 2026-05-06

Theme top-up. Adds an explicit Light / Dark / **Auto (follow system)**
picker to the Settings page; the existing topbar sun / moon icon still
works as a quick toggle. Auto mode reads `prefers-color-scheme` and updates
live when the OS preference changes.

### Added
- **Settings → Theme** card with three options: Light, Dark, Auto. Selection
  persists per-browser (localStorage `visitas-theme`).
- ThemeProvider now exposes `{ choice, applied, setChoice, toggle }` —
  `choice` is what the user picked (incl. `'auto'`), `applied` is what the
  document is actually rendering as.
- `prefers-color-scheme` listener so Auto mode tracks OS-level light/dark
  changes without a page reload.

### Changed
- The topbar icon button now uses `applied` (not `choice`) for its label
  so the swap-to-the-other-one feel is consistent in Auto mode.

## [0.5.0] — 2026-05-06

NDA + safety briefing acknowledgments. Visitor must scroll to the bottom of
the document before they can acknowledge; the NDA additionally needs a drawn
signature on the iPad. Both documents are admin-editable, versioned (each save
bumps), and seeded from `config/visitor-form.json` on first run. After
acknowledgment, a copy of the signed NDA is emailed to the visitor (best-effort
— failure logs but doesn't block sign-in).

### Added
- **Documents** as a first-class entity. `documents(id, kind, version, title,
  body, active)` — `kind` is `nda` or `safety`. Only one active row per kind
  at a time, enforced by a partial unique index. Each save bumps version and
  flips the previous active row inactive (transactional).
- **Visit acknowledgments** — `visit_acknowledgments(id, visit_id FK,
  document_id FK, signed_name, signature_path, acknowledged_at)`. Captured
  alongside the visit; on read the visit payload includes `acknowledgments[]`
  with `kind`, `documentVersion`, `documentTitle`, `signedName`, `signaturePath`,
  `acknowledgedAt`.
- **Drawn signature pad** at the kiosk for NDA — `<canvas>` with pointer
  events (works for finger / stylus / mouse), captures as PNG via
  `toDataURL`. Stored to `data/signatures/visit-{id}-nda.png` and referenced
  from the acknowledgment row.
- **Scroll-to-bottom enforcement** — both safety and NDA bodies must be
  scrolled to the bottom (with a small slop tolerance for sub-pixel
  rounding) before the acknowledge / sign button activates. Short documents
  that fit without scrolling auto-pass. Standard digital "I have seen this"
  pattern.
- **Server-enforced acknowledgment** — `POST /api/visits` refuses with 400
  if the active NDA / safety document exists and the matching acknowledgment
  is missing. NDA additionally requires a non-empty signature; safety just
  needs the row.
- **Email signed NDA copy to visitor** — when the visitor provided an email
  and the email channel is enabled, an HTML email is sent with the NDA
  title, version, full body, signed name, timestamp, and the drawn
  signature inline as a CID attachment. Best-effort; failure logs but does
  not fail the sign-in.
- **Admin Documents page** at `/admin/documents` — two cards (Safety briefing
  + NDA), each showing the active version + title + body with inline edit,
  Save (bumps version), Disable, and a version-history disclosure.
- **`POST /api/documents`**, **`GET /api/documents`** (admin), and
  **`GET /api/documents/active`** (public, kiosk reads) added to the API.
- **Kiosk multi-stage flow** — Form → Safety (if active) → NDA + signature
  (if active) → submit → thanks. A "Step X of Y" indicator at the top.
  Returning to the form after a server-side validation error is preserved.

### Changed
- Marketing site `docs/index.html` roadmap grid updated to reflect actual
  state through v0.5 and the resequenced upcoming releases (v0.6 = visitor
  records + 1-year NDA cache, v0.7 = pre-registration, v0.8 = photo,
  v0.9 = AD).
- Visit creation now also returns `acknowledgments[]` in the visit payload
  (server-side; clients seeing the visit afterwards get the same).
- `audit_log` row for `visit_signed_in` now includes
  `details.acknowledgments` with `[{kind, version}]` so the audit trail
  records exactly which document version each visitor agreed to.

### Internal
- Migration 004 adds the `documents` and `visit_acknowledgments` tables
  with appropriate indexes (active-per-kind partial unique, kind+version
  desc, FK-cascade on visit deletion).
- `services/documents.js` (CRUD + version logic), `services/visitAcknowledgments.js`
  (row writes + signature file persistence), `notifications/visitorNda.js`
  (signed-NDA email with inline-signature attachment, separate test seam
  from the host-notification email transport).
- Visitor form schema now seeds initial NDA + safety bodies from
  `config/visitor-form.json` on first run; once any rows exist, the file
  is no longer consulted (DB authoritative).
- 109 → 128 vitest server tests covering: doc CRUD + version bump + only-one-active,
  public active-doc endpoint sanitized, admin-only writes, security-role
  refused, ack-required-on-active-doc gating, NDA-needs-signature gating,
  signature PNG written to disk, visitor email sent + skipped on
  no-email / channel-disabled, audit details capture acked versions.
- E2E specs extended: admin spec enables both documents; visitor spec
  walks the full form → safety → NDA + signature → thanks → badge flow.

## [0.4.0] — 2026-05-06

Multi-iPad. Each entrance can have its own kiosk URL with its own display
name and a default-printer-name hint, and the workshop can pin the actual
AirPrint default per-iPad via MDM. Visit records carry which kiosk the
visitor signed in at, so the wall view and audit log can answer "who's at
the loading dock vs reception" — useful for fire drills with multiple
muster points.

Plus the long-promised AirPrint badge: after the visitor taps Sign in, the
kiosk pops a printable badge in a side window and triggers `window.print()`,
landing on whatever printer the iPad is bound to.

### Added
- **Kiosks** — first-class entity. Each iPad parks on `/kiosk/<slug>` (e.g.
  `/kiosk/reception`, `/kiosk/loading-dock`). A `default` kiosk is seeded on
  first migration so single-iPad deployments don't need any config; multi-iPad
  workshops add new kiosks under Admin → **Kiosks**. Each kiosk records:
  - `slug` (URL identifier)
  - `name` (display, e.g. "Reception desk", "Loading dock")
  - `defaultPrinterName` — human-readable label shown on the kiosk's "thanks"
    screen and as a small hint at the bottom of the printable badge. The
    actual AirPrint printer assignment is enforced by MDM at the iOS level;
    this field documents the expectation for both visitors and operators.
- **AirPrint-friendly printable badge** at `GET /api/visits/:id/badge`
  (public). Standalone HTML sized for a 4×3 label (`@page size: 4in 3in`),
  visitor name + company + host + date + kiosk, "expires end of day" footer,
  and the configured printer hint at the bottom. Auto-fires `window.print()`
  on load and exposes a manual reprint button.
- **Kiosk auto-print** — after a successful sign-in, the kiosk opens the
  badge URL in a popup window. iOS hands it to AirPrint without further
  visitor interaction.
- **Visit records carry `kiosk_id`** — the active-visitors admin page shows
  a Kiosk column; the public wall view at `/active` shows kiosk per row and
  accepts `?kiosk=<slug>` to filter to a single muster point.
- **Admin Kiosks page** at `/admin/kiosks` — list/create/patch/deactivate
  with inline editing. Refuses to deactivate the `default` kiosk
  (prevents an empty-state lockout).
- **Three role-driven Playwright specs** replace the previous surface-organized
  ones (per the "tests should simulate local users" guidance):
  - `e2e/role-admin.spec.js` — the full admin workflow (forced password
    change, host + security user creation, kiosk config including a printer
    name, Settings panels render).
  - `e2e/role-security.spec.js` — bounded surface (no Users / Kiosks /
    Settings nav, direct admin URLs redirect away, force-sign-out works).
  - `e2e/role-visitor.spec.js` — visitor's actual flow at the kiosk
    (welcome → form validation → sign-in → thanks with printer name and
    badge URL → sign-out at /kiosk/signout → no longer on the wall).

### Changed
- `GET /api/visits/active` now accepts `?kiosk=<slug>` and returns
  `kioskName + kioskSlug` per row in the sanitized payload.
- `GET /api/visits` now accepts `?kiosk=<slug>` for the admin per-kiosk
  filter.
- Topbar hides "Kiosks" from security users (admin-only nav link).

### Internal
- Migration 003 adds the `kiosks` table (with the seeded `default` row),
  rebuilds `visits` to add `kiosk_id` (nullable, FK), and back-fills
  existing on-site visits to the `default` kiosk so historical rows
  stay queryable.
- Routes added: `routes/kiosks.js`. Service: `services/kiosks.js`.
  Service: `services/badge.js` renders the printable HTML.
- 109 → 109+ vitest server tests covering kiosk CRUD, slug uniqueness,
  default-kiosk preservation, visit creation with kiosk slug, wall-view
  filter by kiosk, badge endpoint (HTML, escaping, 404), public sanitized
  reads, admin-only writes, security-role refusal on kiosk admin endpoints.

## [0.3.0] — 2026-05-06

Hosts get pinged when their visitor arrives. Email via SMTP (nodemailer) and
SMS via a small Twilio REST adapter. Both channels disabled by default; flip
the flag in `config/notifications.json` and supply the password / auth token
via env to switch them on.

### Added
- **`config/notifications.json`** — email + sms blocks with per-channel
  `events[]` filter, `enabled` toggle, and transport-specific config
  (SMTP host/port/secure/user; Twilio accountSid + fromNumber). Secrets
  (`SMTP_PASSWORD`, `SMS_AUTH_TOKEN`) come from env vars only — never JSON.
  Default ships both channels disabled and `events: ['signed_in']` so
  switching on email or SMS only pings hosts on visitor arrival.
- **`server/src/notifications/email.js`** — nodemailer transport with lazy
  init and a `setTransportForTests(t)` seam.
- **`server/src/notifications/sms.js`** — direct Twilio REST adapter (no SDK;
  basic auth on `https://api.twilio.com/.../Messages.json`). `log` adapter
  available for development. `setSenderForTests(s)` seam.
- **`server/src/notifications/index.js`** — `notifyVisitEvent(event, { visit, actor })`
  dispatcher routes to email + SMS with per-channel event filtering. Loads
  the host fresh from the DB to pick up email + phone, skips channels the
  host has no contact for, errors logged not propagated. Async wrapper
  `notifyVisitEventAsync` for fire-and-forget dispatch.
- **Visit-lifecycle wiring** — `services/visits.js` now fires `signed_in` on
  create, `signed_out` on visitor self-sign-out, `force_signed_out` on
  admin/security force sign-out (with the actor passed through so the email
  body names the person who signed them out).
- **Test endpoints** — `POST /api/settings/email/test` and
  `POST /api/settings/sms/test` (admin only). Returns 400 when the channel
  is disabled, 200 with delivery status otherwise. Useful for validating
  SMTP / Twilio config without faking a visit.
- **Settings page** gains an Email + SMS test panel each, with a recipient
  input and inline ok/error feedback (mirrors cambiar's email-test pattern).

### Internal
- 76 → 91 vitest server tests covering: signed_in / signed_out / force_signed_out
  routing, per-channel events filter, host-without-contact short-circuit,
  channel-disabled short-circuit, force-sign-out body names actor, both
  test endpoints (success + 400 + non-admin refused).
- Notifications dispatcher uses fake email transport + fake SMS sender via
  the new test seams; tests don't touch the network.

## [0.2.0] — 2026-05-06

The kiosk does what it says on the tin. Visitors sign in at the iPad, the
audit log records every transition, the active-visitors page lets reception
see who's on-site at a glance, and a public wall view is reachable at
`/active` for fire-drill / hallway-monitor scenarios. Notifications, badges,
and the rest of the v0.x roadmap follow.

### Added
- **Visitor sign-in at the kiosk** — `/kiosk` is a real form now: the fields
  are driven from `config/visitor-form.json` (the schema endpoint at
  `GET /api/visitor-form` reads it live), the host typeahead is fed by
  `GET /api/hosts` (sanitized list of active `role=admin` users — security
  users are not hosts). Submission goes to `POST /api/visits`. Trust-the-LAN
  model: no auth on the kiosk surface.
- **Visitor sign-out at the kiosk** — `/kiosk/signout` lists currently active
  visitors as big tap targets; tapping signs you out. `POST /api/visits/:id/sign-out`
  is unauthed (kiosk method).
- **Active-visitors admin page** — `/admin/active-visitors`, reachable by both
  `admin` and the new `security` role. Live list with auto-refresh, force
  sign-out per row (`signed_out_method = 'admin'`, audit row records the
  acting user). Same endpoint (`POST /api/visits/:id/sign-out`) — when called
  with a valid session cookie, the route detects admin/security and records
  it as a force sign-out.
- **Public wall view** — `/active`, no auth. Sanitized to visitor name +
  host + duration only (no email, phone, purpose). Big text, refreshes every
  30 s. Designed for fire drills and hallway monitors. `GET /api/visits/active`
  returns the same sanitized payload.
- **`security` role** — second auth role. Can see `/admin/active-visitors`
  and force-sign-out, and that's it. Cannot manage users, cannot edit
  branding, no host typeahead presence. Created via the Users admin page
  (formerly Hosts) by picking the role on user creation. Admins can also
  promote/demote between roles, with last-active-admin protection.
- **Audit log for visit transitions** — every sign-in (`visit_signed_in`),
  visitor self-sign-out (`visit_signed_out`), and admin force sign-out
  (`visit_force_signed_out`) writes a row capturing actor, method, and
  visit id. `services/audit.js` exposes `recordAudit` + `loadAudit`.
- **Hosts admin page renamed to "Users"** — reflects that security users
  also live here. Role column with inline pick + save. Last-active-admin
  guard (UI mirrors the API).

### Changed
- `users.role CHECK` widened from `('admin')` to `('admin', 'security')`.
  Migration `002_visits.sql` does a table-rebuild dance with foreign_keys
  briefly toggled off (the `@no-tx` opt-out lets the migration manage its
  own transactions and PRAGMAs).
- Topbar visibility is now role-aware: admins see Users / Active visitors /
  Settings / Kiosk; security sees only Active visitors.
- `GET /api/users` and the entire `/api/users` router are admin-only —
  security users get 403 there.

### Internal
- Migration 002 adds the `visits` table (host_user_id FK→users; status check
  `on_site`/`signed_out`; `signed_out_by_user_id`, `signed_out_method` check
  `kiosk`/`admin`; indexes on status, signed_in_at, host).
- Routes added: `routes/visitorForm.js`, `routes/hosts.js`, `routes/visits.js`.
  Service: `services/visits.js`.
- Web pages added: `Kiosk.jsx` rewritten, `KioskSignOut.jsx`,
  `ActiveVisitors.jsx`, `WallView.jsx`. `Users.jsx` replaces `Hosts.jsx`.

### Tests
- 46 → 76 vitest server tests covering the new visit lifecycle, the role
  split (security cannot reach admin-only routes; admin can promote/demote
  between roles; last-admin demotion guarded), public sign-in / sign-out
  audit recording, force sign-out audit recording, public wall view
  sanitization, and visitor-form schema endpoint.
- E2E spec extended with kiosk → wall view → admin force sign-out flow,
  and a security-role boundary spec.

## [0.1.0] — 2026-05-06

Initial scaffold. Lifts the architectural skeleton from sister project
[cambiar.world](https://djsincla.github.io/cambiar/) and adapts it to the
visitor sign-in domain. The actual visitor sign-in flow, host notifications,
badge printing, NDA capture, photo capture, pre-registration, and AD lookup
all land in v0.2 onwards (see the project site for the planned roadmap).

### Added
- API-first Node.js + Express backend with SQLite persistence (better-sqlite3, WAL).
- Authentication: local accounts (bcrypt). Active Directory / LDAP scaffolding
  is in place but disabled until v0.7.
- Bootstrap `admin` / `admin` account created on first run, forced to change
  password on first login.
- Single-role model: every user is an admin and every admin is also a host.
  Visitors are not users — they'll be tracked in their own table when v0.2
  introduces the kiosk sign-in flow.
- Host CRUD (`/api/users`): create, list, edit, deactivate, reset password
  (generates a strong random password and forces change on next login).
  Last-active-admin protection.
- Configurable branding: admin-uploadable logo (PNG, SVG, JPEG, or WebP, max
  1 MB) and app name. Renders top-left for everyone, including the login
  screen and the kiosk.
- React + Vite single-page app served by Express in production. Light + dark
  theme, default dark; toggle persisted per browser.
- Kiosk shell at `/kiosk` — accessible without auth, but in v0.1 it's a
  placeholder card with a disabled sign-in button. v0.2 wires up the real flow.
- Configurable visitor-form schema at `config/visitor-form.json` — sample fields
  (name, company, email, phone, host typeahead, purpose, notes) plus disabled
  blocks for NDA, safety briefing, and photo capture (light up in later versions).
- Reset-admin CLI (`npm run reset-admin`) — host-side password recovery, no API
  equivalent. Generates a strong random password, sets `must_change_password=1`,
  reactivates a disabled account, and creates the user as admin if missing.
  Refuses AD-sourced users.
- Multi-stage Dockerfile + `docker-compose.yml` for single-container deployment.
- GitHub Actions CI: vitest server tests, Vite build, Docker build, and
  Playwright E2E (chromium) on every push and pull request.
- Marketing landing page at `docs/index.html` (publishable to GitHub Pages),
  styled to match cambiar.world's accent so the two products feel like one suite.
  Includes the &ldquo;What it isn't&rdquo; honesty section and the
  &ldquo;Approved by Mike&rdquo; seal in the hero.
- Apache-2.0 license.

### Tests
- 46 vitest server tests (meta, auth, branding, users, reset-admin) covering the
  v0.1 surface.
- 2 Playwright E2E specs covering the bootstrap admin → forced password change
  → topbar branding → sign out flow, and confirming the kiosk is reachable
  without auth.
