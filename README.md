# visitas.world

**[→ visitas.world (project site)](https://djsincla.github.io/visitas/)** &nbsp;·&nbsp; **[Issues & support](https://github.com/djsincla/visitas/issues)**

Visitor sign-in / registration for small workshops. Node.js + React, iPad-friendly kiosk surface, local or Active Directory hosts, branding, single-container deploy.

> The name is from the Spanish noun *visitas* — "visits". The repository directory and git URL keep the short form `visitas`; everywhere else (UI, emails, calendar feeds, branding) the product is **visitas.world**. Sister project to [**cambiar.world**](https://djsincla.github.io/cambiar/) — same workshop, same stack.

For a higher-level overview of what the project is, who it's for, and what it deliberately is *not*, see the [project site](https://djsincla.github.io/visitas/). The rest of this README is the operator-facing manual: installation, configuration, recovery, and the API surface.

## Status

**v0.3 — host notifications.** v0.2's kiosk plus: hosts get pinged when their visitor arrives, via email (SMTP / nodemailer) and SMS (Twilio REST). Both channels off by default; flip the flag in `config/notifications.json` and supply secrets via env. Settings page has test buttons for both. Badge printing, NDA capture, photo capture, pre-registration, and AD lookup all land in v0.4 onwards. See [CHANGELOG.md](CHANGELOG.md).

## Contents

- [Quick start (Docker)](#quick-start-docker)
- [Quick start (local development)](#quick-start-local-development)
- [Default credentials](#default-credentials)
- [Resetting the admin password](#resetting-the-admin-password)
- [Repo layout](#repo-layout)
- [Configuration](#configuration)
- [Visitor form schema](#visitor-form-schema)
- [Branding (logo + app name)](#branding-logo--app-name)
- [API reference (v0.1)](#api-reference-v01)
- [Development](#development)
- [Testing](#testing)
- [License](#license)

## Quick start (Docker)

```bash
git clone https://github.com/djsincla/visitas && cd visitas
cp .env.example .env
# Required: set JWT_SECRET to something long and random.
#   JWT_SECRET=$(openssl rand -hex 64)

docker compose up -d --build
# Admin UI:    http://localhost:3000  →  log in admin / admin (forced password change)
# Kiosk:       http://localhost:3000/kiosk  (placeholder in v0.1)
```

The container persists its SQLite database in `./data/` and reads JSON config from `./config/` (mounted read-only). Edit `config/visitor-form.json` before first deploy to customize what the kiosk asks visitors. After editing, run `docker compose restart visitas` to apply.

## Quick start (local development)

```bash
npm install
cp server/.env.example server/.env       # set JWT_SECRET
npm run migrate                          # creates data/visitas.sqlite, bootstraps admin/admin
npm run dev                              # API on :3000, web on :5173 with hot reload
```

For a production-style local run:
```bash
npm run build
npm start                                # serves API + built web on :3000
```

The Vite dev server proxies `/api/*` and `/uploads/*` to the server, so a single `http://localhost:5173` URL works for development.

## Default credentials

First login: **`admin` / `admin`**. The bootstrap admin is forced to change their password on first login (`must_change_password=1`). After that, manage all hosts (= admins, in v0.1) through the admin UI at `/admin/hosts`.

## Resetting the admin password

If the admin password is lost or all admins get locked out, run the reset-admin CLI from the host. By design there is **no API equivalent** — recovery requires direct access to `data/visitas.sqlite`, the same trust boundary as the database file itself.

```bash
# Local install
npm run reset-admin                                # generates a strong random password and prints it
npm run reset-admin -- --password 'MyNewPwd1234'   # set a specific password
npm run reset-admin -- --username admin2           # reset (or create) admin2

# Docker (running container)
docker compose exec visitas npm run reset-admin
docker compose exec visitas npm run reset-admin -- --password 'MyNewPwd1234'

# Docker (one-shot, container not running)
docker compose run --rm visitas npm run reset-admin
```

What it does:

- **User exists** → updates the password, sets `must_change_password=1`, sets `active=1`. Role is **not** changed.
- **User doesn't exist** → creates them with `role=admin`, `must_change_password=1`, `active=1`.
- **AD-sourced user** → refused (use AD password reset instead).
- The user must change the password on first login.

The script applies any pending migrations before doing the reset, so it's safe on a fresh install too.

## Repo layout

```
visitas/
├── server/                  Express API + SQLite + auth + tests
│   ├── src/
│   │   ├── app.js           Express app factory (used by index.js and tests)
│   │   ├── index.js         Production entry — runs migrations, bootstraps admin, listens
│   │   ├── auth/            jwt, password hashing
│   │   ├── db/              schema migrations (.sql), runner, sqlite singleton
│   │   ├── middleware/      requireAuth, requireRole, blockIfPasswordChangeRequired
│   │   ├── routes/          auth, users, settings
│   │   ├── services/        settings (branding)
│   │   └── cli/             reset-admin
│   └── test/                vitest tests (one file per route surface)
├── web/                     Vite + React SPA (served by Express in production)
│   └── src/
│       ├── App.jsx          Router + topbar (Hosts / Settings / Kiosk)
│       ├── auth.jsx         AuthProvider (login/logout/refresh)
│       ├── branding.jsx     BrandingProvider (logo/appName fetched at boot)
│       ├── theme.jsx        Light/dark toggle
│       ├── api.js           fetch wrapper
│       └── pages/           Login, ChangePassword, Hosts, Settings, Kiosk
├── config/                  visitor-form.json (kiosk field schema, sample)
├── data/                    SQLite db + uploads/  (volume-mounted, gitignored)
├── docs/                    Marketing site (GitHub Pages source)
├── e2e/                     Playwright specs
├── .github/workflows/ci.yml CI pipeline
├── Dockerfile               multi-stage (web-build → server-install → runtime)
└── docker-compose.yml
```

## Configuration

| Where | What | Lifetime |
| --- | --- | --- |
| `.env` (Docker) / `server/.env` (local) | Secrets: `JWT_SECRET`, `AD_BIND_PASSWORD`, `SMTP_PASSWORD`, `SMS_AUTH_TOKEN` | Read on every server start |
| `config/visitor-form.json` | Kiosk field schema (sample only in v0.1; consumed by v0.2's kiosk) | Seeded into DB on first migration once v0.2 lands; admin UI authoritative thereafter |
| `data/visitas.sqlite` | Users, settings, audit log | Authoritative |
| `data/uploads/` | Admin-uploaded files (e.g. logo) | Authoritative |

Secrets always come from env vars, never from JSON.

## Visitor form schema

`config/visitor-form.json` describes what the kiosk asks visitors at sign-in. v0.1 ships the file as a sample but doesn't yet consume it — v0.2's kiosk seeds it into the DB on first migration and reads from there. Edit this file before first deploy to customize the questions; after v0.2 lands, manage them through the admin UI instead.

Field types: `text`, `email`, `tel`, `select` (with `options[]`), `textarea`, `boolean`, plus a special `host-typeahead` type that the kiosk renders as an autocomplete fed from local users + AD `visitas-world` group members.

The file also has scaffolding for `nda`, `safety`, and `photo` blocks — disabled in v0.1, light up in v0.5 / v0.5 / v0.6 respectively.

## Branding (logo + app name)

Admin → **Settings** → upload PNG / SVG / JPEG / WebP (max 1 MB). The logo renders top-left for every user, including on the login screen and the kiosk. Files persist in `data/uploads/`. Replacing or removing the logo deletes the previous file.

The app name (default `visitas.world`) shown in the topbar when no logo is set is also editable on this page.

## Email and SMS

In `config/notifications.json` (mounted into the container read-only at `/app/config/`):

```json
{
  "email": {
    "enabled": true,
    "from": "visitas.world <hello@your-workshop.com>",
    "smtp": { "host": "smtp.example.com", "port": 587, "secure": false, "user": "visitas@example.com" },
    "events": ["signed_in"]
  },
  "sms": {
    "enabled": false,
    "adapter": "twilio",
    "twilio": { "accountSid": "ACxxx", "fromNumber": "+15555555555" },
    "events": ["signed_in"]
  }
}
```

Secrets always come from env: `SMTP_PASSWORD`, `SMS_AUTH_TOKEN`. The `events[]` array filters which transitions fire that channel; supported events are `signed_in`, `signed_out`, `force_signed_out`. Per-host contact info is taken from the user record (admin can edit phone/email on the Users admin page).

Restart the container after editing `config/notifications.json` to apply (`docker compose restart visitas`). Once up, use Settings → Email / SMS to send a test message and verify delivery.

## API reference (v0.3)

`GET /api` returns a live endpoint index.

### Auth — `/api/auth`
- `POST /login` — `{ username, password }` → sets `visitas_session` cookie + returns user
- `POST /logout`
- `GET  /me`
- `POST /change-password` — `{ currentPassword, newPassword }`

### Users (admin) — `/api/users`
- `GET /` — list
- `POST /` — create local user; `role` is `admin` (host + full admin) or `security` (active-visitors only). Defaults to `admin`.
- `PATCH /:id` — partial update (email, displayName, phone, active, role). Last-active-admin protection on disable + demote.
- `POST /:id/reset-password` — admin reset; user must change on next login. Refuses for AD users.

### Visits — `/api/visits`
- `POST /` — **public, no auth** — `{ visitorName, hostUserId, company?, email?, phone?, purpose?, fields? }`. Trust-the-LAN; the kiosk surface is unauthenticated.
- `GET /active` — **public, sanitized** — list of currently on-site visits with `{ id, visitorName, hostName, signedInAt }`. Used by the wall view at `/active`.
- `POST /:id/sign-out` — visitor self-sign-out when called without auth (`signed_out_method='kiosk'`); admin/security force sign-out when called with a session cookie (`signed_out_method='admin'`, audit row records the actor).
- `GET /` — admin or security — full list with all fields, supports `?status=on_site|signed_out`.
- `GET /:id` — admin or security — single visit with all fields.

### Visitor form schema — `/api/visitor-form`
- `GET /` — **public** — returns the kiosk field schema, read live from `config/visitor-form.json` on each call. Edit the JSON to change what the kiosk asks. (Admin UI editing lands in a later release; until then the file is authoritative.)

### Hosts (kiosk typeahead) — `/api/hosts`
- `GET /` — **public, sanitized** — `{ hosts: [{ id, displayName }] }`. Filtered to active `role=admin` users (security users are not hosts). Used by the kiosk's host typeahead.

### Notification test endpoints (admin)
- `POST /api/settings/email/test` — `{ to }` → sends a test email through the configured SMTP. 400 if disabled.
- `POST /api/settings/sms/test` — `{ to }` → sends a test SMS through the configured Twilio adapter. 400 if disabled.

### Settings — `/api/settings`
- `GET /branding` — **public** (no auth) — `{ appName, logoUrl, version }`. Used by the login screen and kiosk.
- `PUT /branding` (admin) — `{ appName? }`
- `POST /branding/logo` (admin, multipart `logo` field) — PNG/SVG/JPEG/WebP, max 1 MB
- `DELETE /branding/logo` (admin) — clears the logo

### Meta
- `GET /api/health` — `{ ok: true, version }`
- `GET /api` — endpoint index

Uploaded files are served at `/uploads/<filename>` (no auth — these are public branding assets).

## Development

```bash
npm run dev      # server (3000) + web (5173) with hot reload
npm test         # server tests (vitest)
npm run test:e2e # Playwright E2E (uses port 3500)
npm run build    # build the SPA into web/dist/ for npm start
```

## Testing

visitas is API-first: the test suite is the contract. Any change to an API endpoint must come with a test change, and `npm test` must stay green before merging.

Tests run against an **in-memory SQLite** with a per-test reset (`resetDb()` in `server/test/helpers.js`), so they're hermetic and fast.

## License

Apache License 2.0 — see [LICENSE](LICENSE) and [NOTICE](NOTICE).
