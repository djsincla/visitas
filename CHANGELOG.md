# Changelog

All notable changes to visitas.world are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses semantic versioning.

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
