# visitas.world

**[→ visitas.world (project site)](https://djsincla.github.io/visitas/)** &nbsp;·&nbsp; **[Issues & support](https://github.com/djsincla/visitas/issues)**

Visitor sign-in / registration for small workshops. Node.js + React, iPad-friendly kiosk surface, local or Active Directory hosts, branding, single-container deploy.

> The name is from the Spanish noun *visitas* — "visits". The repository directory and git URL keep the short form `visitas`; everywhere else (UI, emails, calendar feeds, branding) the product is **visitas.world**. Sister project to [**cambiar.world**](https://djsincla.github.io/cambiar/) — same workshop, same stack.

For a higher-level overview of what the project is, who it's for, and what it deliberately is *not*, see the [project site](https://djsincla.github.io/visitas/). The rest of this README is the operator-facing manual: installation, configuration, recovery, and the API surface.

## Status

**1.2.0 — visitor bans.** Admins and security can ban visitors (by visitor record, email, or name + optional company). Banned sign-ins are refused at the kiosk with a generic &ldquo;please see reception&rdquo; message, audited, and trigger an email + SMS to all on-duty admin/security so the floor team can intercept the visitor at the door. Bans beat invitations. See [CHANGELOG.md](CHANGELOG.md).

## Contents

- [Quick start (Docker)](#quick-start-docker)
- [Quick start (local development)](#quick-start-local-development)
- [HTTPS for the kiosk (production)](#https-for-the-kiosk-production)
- [Default credentials](#default-credentials)
- [Resetting the admin password](#resetting-the-admin-password)
- [Repo layout](#repo-layout)
- [Configuration](#configuration)
- [Visitor form schema](#visitor-form-schema)
- [Branding (logo + app name)](#branding-logo--app-name)
- [Email and SMS](#email-and-sms)
- [Multi-iPad / kiosk identity](#multi-ipad--kiosk-identity)
- [NDA + safety briefing](#nda--safety-briefing)
- [Pre-registration via QR](#pre-registration-via-qr)
- [Photo capture (opt-in)](#photo-capture-opt-in)
- [Visitor bans](#visitor-bans)
- [Active Directory](#active-directory)
- [API reference (v0.9)](#api-reference-v09)
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

## HTTPS for the kiosk (production)

The kiosk's photo capture (v0.8+) uses the browser's `getUserMedia` API, which **requires an HTTPS origin** — browsers block camera access on plain `http://` for everything except `localhost`. If you don't enable photo capture you can run on `http://` indefinitely and skip this section, but the moment you flip the toggle in Settings → Photo capture you'll need TLS terminating in front of the container.

Three pragmatic options for a small workshop:

### Option A — Caddy reverse proxy (recommended)

[Caddy](https://caddyserver.com) terminates TLS automatically — Let's Encrypt for an internet-reachable hostname, or its own internal CA for a LAN-only deploy. One-line config:

```caddyfile
visitas.workshop.local {
    reverse_proxy visitas:3000
    tls internal
}
```

Run Caddy alongside visitas in `docker-compose.yml`. iPads need the Caddy local CA root trusted once via an iOS configuration profile — Caddy serves it at `https://your-host/auto/`. After that, `https://visitas.workshop.local` works on every iPad on the LAN, including camera permission prompts.

For an internet-reachable hostname, replace `tls internal` with nothing — Caddy auto-provisions a real Let's Encrypt cert.

### Option B — mkcert for LAN-only

If you don't want a reverse proxy, [mkcert](https://github.com/FiloSottile/mkcert) generates locally-trusted certs:

```bash
mkcert -install                                  # adds the root CA to your trust store
mkcert visitas.workshop.local 192.168.1.42       # generate cert + key for the LAN address
# move .pem files into ./certs/, point your TLS-terminating proxy at them
```

Each iPad needs the mkcert root CA installed once via a configuration profile (export with `mkcert -CAROOT` and email or AirDrop the `rootCA.pem` to the device). After install + trust, the cert is valid on iOS and the camera prompt works.

### Option C — A proper cert from a real CA

If the workshop hostname is reachable from the public internet (e.g. `visitas.example.com`), use Let's Encrypt directly via [acme.sh](https://github.com/acmesh-official/acme.sh) or your existing infra. Drop the cert + key into the same TLS-terminating proxy as A or B.

### Wiring it into docker-compose

`docker-compose.yml` ships with the visitas container exposed on `:3000` directly. For production with TLS, run a Caddy / nginx / Traefik service alongside that points at the visitas container's internal port and binds `:443` on the host. The visitas service itself doesn't terminate TLS — it serves plain HTTP behind the proxy. Set `BASE_URL=https://your-host` in `.env` so links in invitation emails use the right scheme.

> **MDM note**: if your iPads are managed (via Apple Business Manager / Jamf / similar), push the root CA as a configuration profile rather than relying on visitors trusting it manually — same flow as for any internal service.

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

## Multi-iPad / kiosk identity

Every iPad parks on `/kiosk/<slug>` (e.g. `/kiosk/reception`, `/kiosk/loading-dock`). Bookmark the kiosk URL on the iPad's home screen — the bookmark is the kiosk's identity. A `default` kiosk is seeded on first migration so single-iPad workshops can just hit `/kiosk` and it'll redirect.

Manage kiosks at **Admin → Kiosks**. Each kiosk has:

- a unique `slug` (lowercase, dashes — used in the URL);
- a display `name` (shown on the kiosk header + the printable badge + active-visitors page);
- an optional **default printer name** — a human-readable label shown on the kiosk's "thanks" screen and at the bottom of the printable badge. It's a hint, not enforcement: the actual AirPrint default printer per iPad is configured via MDM at the iOS level.

Visit records carry `kiosk_id`, so the wall view and admin active-visitors page can filter by kiosk (`?kiosk=loading-dock` on `/active` or the admin endpoint), useful for fire drills with multiple muster points.

## NDA + safety briefing

Both are optional documents managed under **Admin → Documents**. Save the body of each (the textareas pre-fill with sensible defaults the first time); each save bumps the active version. Visitors must scroll to the bottom of the body before the acknowledge / sign button activates. The NDA additionally requires a drawn signature on a `<canvas>` (works for finger / stylus / mouse).

Acknowledgments are recorded against the visit:

- `data/signatures/visit-{id}-nda.png` — the drawn signature (kept indefinitely, this is the audit record).
- `visit_acknowledgments` table — one row per (visit, document) acknowledgment, with `document_version`, `signed_name`, `acknowledged_at`.

If the email channel is enabled (`config/notifications.json`) and the visitor provided an email, the kiosk also emails them a copy of the signed NDA — HTML body with the agreement text + their signature embedded as a CID inline image.

**1-year NDA cache** (v0.6+): if the same visitor (matched by email) acknowledged the *current* active NDA version in the last 365 days, the kiosk skips the NDA step on this visit. New version of the NDA = everyone re-signs.

## Pre-registration via QR

Hosts pre-book visitors under **Admin → Invitations**. Each invitation gets a random 32-hex token + a kiosk URL with the token in the query string (`?invite=<token>`). If the email channel is enabled, visitas mails the visitor an HTML email with the kiosk URL plus an inline QR code of the same URL. Single-use, 7-day expiry by default; admins can also copy the link manually if email is off.

On arrival the visitor opens the link (or scans the QR with their iPhone camera, which opens the URL in Safari). The kiosk reads the token, pre-fills name / company / email / phone, **locks the host** to the pre-booked one, and shows a "You were expected" banner. Submit marks the invitation `used` and links it to the new visit; the audit row records `details.invitationId` + `details.source: 'invitation'`.

## Photo capture (opt-in)

Enabled via **Admin → Settings → Photo capture** (default off; privacy is opt-in). When on, the kiosk inserts a Photo stage between the form and the safety briefing — front-facing camera preview, Take photo / Retake / Use this photo flow. The photo prints on the badge as a 28×28 mm right-floated image and is stored at `data/photos/visit-{id}.png`.

**Retention**: photos are auto-purged 30 days after sign-in by a sweep that runs on server boot and every 24 hours after. Visit rows stay (audit), but `photo_path` gets nulled and the file deleted. Adjust the constant in `server/src/services/photo.js` if your jurisdiction requires a different window.

**Camera access requires HTTPS** in production — see the [HTTPS for the kiosk](#https-for-the-kiosk-production) section above before flipping the toggle on a deployed iPad.

## Visitor bans

Admin and security users (both roles) can ban visitors via **Admin → Bans**, or directly from the Visitors / Active Visitors page row actions. Three match modes:

- **By visitor record** (most specific) — for a returning visitor with a known email, bans them across all sign-in variants. Even falls back to name + company match if they reappear without their email.
- **By email** (case-insensitive exact) — useful before they ever sign in (they have no visitor record yet).
- **By name + company** (case-insensitive substring) — last-resort match for emailless walk-ins.

Each ban requires a **reason** (text, audit-log only — never shown to the visitor) and optionally an **expiry** (`expires_at`; lazy-expired on read). Bans can be **lifted** (with optional lift reason).

When a banned visitor tries to sign in:
1. The kiosk shows a generic refusal: *&ldquo;Sign-in not permitted. Please see reception.&rdquo;* The visitor never sees the reason or knows which match fired.
2. The server writes an `audit_log` row with action `visit_signin_blocked` and the matched ban id.
3. A `signin_blocked` notification fires (email + SMS) to all active admin + security users so reception can intercept at the door.
4. The visit row is **not** inserted; pre-registration invitations are **not** marked used.

Bans beat invitations: a pre-registered visitor on the deny list is still refused.

## Active Directory

AD is opt-in via `config/auth.json`. With `auth.ad.enabled = true` and the bind password supplied via the `AD_BIND_PASSWORD` env var, login attempts that don't match a local user fall through to LDAP:

```json
{
  "local": { "enabled": true, "passwordMinLength": 10 },
  "ad": {
    "enabled": true,
    "url": "ldaps://ad.example.com:636",
    "bindDN": "cn=visitas-svc,ou=ServiceAccounts,dc=example,dc=com",
    "searchBase": "ou=Users,dc=example,dc=com",
    "searchFilter": "(&(objectCategory=person)(objectClass=user)(sAMAccountName={username}))",
    "tlsRejectUnauthorized": true,
    "allowedGroup": "visitas-world",
    "attributes": { "username": "sAMAccountName", "email": "mail", "displayName": "displayName" }
  }
}
```

Restart visitas after editing the config. Per-deployment notes:

- **`searchFilter`** uses `(&(objectCategory=person)(objectClass=user)…)` so machine / computer accounts are excluded — only human users in the workshop's AD can log in. Adjust if you're on OpenLDAP or FreeIPA (those use `uid={username}` instead of `sAMAccountName={username}`).
- **`allowedGroup`** is a case-insensitive **substring** match against each `memberOf` DN. The default `visitas-world` matches `cn=Visitas-World,ou=Groups,dc=example,dc=com`. Empty / unset = any AD user can log in (rare; the workshop normally pins to a single group).
- **`bindDN`** is a service account in AD with read access to the search base. The bind password lives in env (`AD_BIND_PASSWORD`), never in JSON.
- **Local takes precedence**. If a local account and an AD account share a username, login uses the local account's password. The bootstrap admin (`admin/admin`) is always local — if AD is down or misconfigured, the workshop can still log in.

### What an AD login does

On first AD login, visitas creates a `users` row with `source='ad'`, `role='admin'`, no `password_hash`. Subsequent logins refresh `email` and `display_name` from the AD attributes. AD users **become hosts**: once they've logged in, they appear in the kiosk's host typeahead (`/api/hosts`).

> **First-time visibility**: an AD user must log in once before they show up in the host typeahead. For workshops with a small admin team this is fine — each member signs in once on their first day. For larger orgs you can periodically run a sync script that walks the AD group; we don't ship one in v0 (open an issue if it's important).

### Disabling local password change for AD users

`POST /api/auth/change-password` refuses for `source='ad'` accounts (returns 400 with `"AD-authenticated users must change password in AD"`) — those accounts have no local password to change.

## API reference (v1.2)

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

### Visitor bans — `/api/bans` (admin + security)
- `GET /` — list all bans (or `?status=active|inactive` to filter).
- `GET /:id` — single ban.
- `POST /` — `{ mode, ...matchFields, reason, expiresAt? }`. `mode` is one of `'visitor'|'email'|'name'`. Match-field requirements depend on mode (`visitorId` for `visitor`, `email` for `email`, `namePattern` + optional `companyPattern` for `name`).
- `POST /:id/lift` — `{ liftReason? }`. Soft-lifts the ban; record is preserved for audit.
- A banned-attempt sign-in produces a 403 from `POST /api/visits` with the message `Sign-in not permitted. Please see reception.` (the kiosk shows this verbatim; the reason is intentionally not leaked).

### Notification test endpoints (admin)
- `POST /api/settings/email/test` — `{ to }` → sends a test email through the configured SMTP. 400 if disabled.
- `POST /api/settings/sms/test` — `{ to }` → sends a test SMS through the configured Twilio adapter. 400 if disabled.

### Photo toggle — `/api/settings/photo`
- `GET /` — `{ enabled }`.
- `PUT /` (admin) — `{ enabled: bool }` to flip the photo-capture channel on/off.

### Kiosks — `/api/kiosks`
- `GET /:slug` — **public, sanitized** — `{ kiosk: { slug, name, defaultPrinterName } }`. The kiosk SPA reads this on load.
- `GET /` — admin — full list incl. timestamps + active flag.
- `POST /` (admin) — `{ slug, name, defaultPrinterName? }`. Slug is `[a-z0-9-]+`, unique.
- `PATCH /:slug` (admin) — `{ name?, defaultPrinterName?, active? }`.
- `DELETE /:slug` (admin) — soft-deactivate. Refuses on `default`.

### Printable badge — `/api/visits/badge/:token`
- `GET /` — **public, token-keyed** — standalone printable HTML, sized for 4×3 inch label, auto-fires `window.print()`. Includes the visitor's photo when present. The 64-hex `publicToken` comes back on the `POST /api/visits` response and is what the kiosk uses for the reprint link.

### Photo — `/api/visits/photo/:token`
- `GET /` — **public, token-keyed** — serves the captured PNG when present (returns 404 after the 30-day retention sweep purges it, or for visits where no photo was captured). Same `:token` as the badge; sequential ids alone won't fetch.

### Documents — `/api/documents`
- `GET /active` — **public, sanitized** — `{ documents: [{ id, kind, version, title, body }] }`. Used by the kiosk to render NDA + safety screens.
- `GET /` (admin) — full version history, optionally `?kind=nda|safety`.
- `POST /` (admin) — `{ kind, title, body }`. Each save bumps the version (no-op if title + body unchanged).
- `DELETE /:kind` (admin) — deactivate the active document of that kind.

### Visitors — `/api/visitors`
- `POST /lookup` — **public** — `{email}` → returning-visitor pre-fill payload (name / company / phone / `ndaCacheFresh` / `ndaCacheVersion`). 404 on unknown email.
- `GET /` (admin) — list every visitor with derived visit count + NDA cache state.

### Invitations — `/api/invitations`
- `GET /:token` — **public, sanitized** — kiosk reads invitation by token. 410 for `used` / `cancelled` / `expired`.
- `GET /` (admin) — list with optional `?status=`.
- `POST /` (admin) — `{ visitorName, email, hostUserId, kioskSlug?, expectedAt?, purpose?, expiryDays? }`. Sends email best-effort (with QR), returns the invitation including `token`.
- `POST /:id/resend` (admin) — re-fires the email.
- `DELETE /:id` (admin) — cancel.

### Visit creation extensions — `/api/visits`
The base `POST /api/visits` accepts these additional optional fields:
- `acknowledgments[]: [{kind, signedName?, signaturePngBase64?}]` — one entry per active document. NDA additionally requires a non-empty signature. Server enforces; missing required ack returns 400. (See [NDA + safety](#nda--safety-briefing).)
- `inviteToken` — locks host (and kiosk if pinned) to the invitation, marks it `used` on success. (See [Pre-registration](#pre-registration-via-qr).)
- `photoPngBase64` — captured visitor photo. Silently ignored when `settings.photo.enabled = false`. Capped at 5 MB. (See [Photo capture](#photo-capture-opt-in).)

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
