# Changelog

All notable changes to visitas.world are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses semantic versioning.

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
