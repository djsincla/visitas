# Changelog

All notable changes to visitas.world are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses semantic versioning.

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
