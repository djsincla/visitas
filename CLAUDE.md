# visitas — instructions for Claude

You are working on **visitas.world**, a visitor sign-in / registration app for a small VFX workshop. Sister project to **cambiar.world** (in `../cambiar`). The repo directory and git URL are short — `visitas` — but the *product* is `visitas.world`.

This file is auto-loaded into every Claude Code session in this folder. Read your `memory/` first; this file is the quick orientation.

## What this project is

A self-hosted, single-container app where visitors arriving at the workshop sign in (name, company, host, purpose), notify their host, and sign out on departure. An "active visitors" view shows who's currently on-site for safety/fire-roster purposes. Audit log retains a full record.

Some v0 design decisions are still open — see `memory/project_visitas.md` for the open questions to ask before building (kiosk-vs-operator UX, NDA capture, photos, pre-registration, AD).

## What this project is NOT

- Not a workplace management platform. No desk booking, no room reservations, no asset tracking.
- Not a CRM. The visitor record exists for safety + audit, not for marketing.
- Not multi-tenant. One container, one workshop.

## Stack and conventions

Mirror cambiar's choices unless there's a specific reason to deviate:

- Node 20+ on Express, ESM, `better-sqlite3` for storage in `data/`
- React + Vite SPA, single container serving both
- JWT in HttpOnly cookies, bcrypt for local passwords; optional AD via `ldapts`
- Migrations as numbered SQL files in `server/src/db/migrations/`
- Vitest + supertest server-side, Playwright for E2E
- Multi-stage Dockerfile, `docker compose up -d --build`
- Apache-2.0 license
- Marketing/landing page at `docs/index.html` (so GitHub Pages can publish it)

If you're unsure how something should be shaped — directory layout, helpers, test fixtures, app.js wiring, CI workflow — read the equivalent file in `../cambiar` first. Borrow the skeleton, adapt the domain.

## Workflow

- One feature → one minor version bump → CHANGELOG entry → commit → push. Don't batch.
- Show intent in 1 sentence before the first tool call. Be brief in updates; the user reads diffs.
- For exploratory questions, give 2–3 sentences with a recommendation + tradeoff, then wait.
- Confirm before destructive or shared-state actions (force push, repo visibility, sending email).

## Branding inheritance

- The product name is `visitas.world` everywhere user-visible (UI, emails, calendar feeds, marketing).
- The directory and git URL stay `visitas`.
- Apache-2.0, "honest" copy ("what it isn't" is part of the marketing).
- Mike has approved this project too. Mike has not read the source.

## Reference paths

- Sister project: `/Users/dwayne/Developer/cambiar`
- Cambiar marketing: `/Users/dwayne/Developer/cambiar/docs/index.html`
- Cambiar docs site (GitHub Pages): `https://djsincla.github.io/cambiar/`

When in doubt, look at how cambiar did it before inventing.
