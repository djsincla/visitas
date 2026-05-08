import express from 'express';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from './config.js';
import { logger } from './logger.js';
import authRouter from './routes/auth.js';
import usersRouter from './routes/users.js';
import settingsRouter from './routes/settings.js';
import visitorFormRouter from './routes/visitorForm.js';
import hostsRouter from './routes/hosts.js';
import visitsRouter from './routes/visits.js';
import kiosksRouter from './routes/kiosks.js';
import documentsRouter from './routes/documents.js';
import visitorsRouter from './routes/visitors.js';
import invitationsRouter from './routes/invitations.js';
import bansRouter from './routes/bans.js';

/**
 * Build an Express app instance. Migrations and admin bootstrap are NOT
 * performed here — callers (the runtime entry, or test setup) own that.
 */
export function createApp({ httpLogger = true } = {}) {
  const app = express();

  if (httpLogger) {
    app.use(pinoHttp({
      logger,
      customLogLevel: (req, res, err) => err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
    }));
  }
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => res.json({ ok: true, version: '1.2.0' }));
  app.get('/api', (_req, res) => res.json({
    name: 'visitas',
    version: '1.2.0',
    endpoints: [
      'POST /api/auth/login',
      'POST /api/auth/logout',
      'GET  /api/auth/me',
      'POST /api/auth/change-password',
      'GET  /api/users (admin)',
      'POST /api/users (admin)',
      'PATCH /api/users/:id (admin)',
      'POST /api/users/:id/reset-password (admin)',
      'GET  /api/settings/branding (public)',
      'PUT  /api/settings/branding (admin)',
      'POST /api/settings/branding/logo (admin)',
      'DELETE /api/settings/branding/logo (admin)',
      'GET  /api/visitor-form (public)',
      'GET  /api/hosts (public, sanitized)',
      'POST /api/visits (public — kiosk)',
      'GET  /api/visits/active (public, sanitized — wall view)',
      'GET  /api/visits/badge/:token (public — token-keyed, unenumerable)',
      'GET  /api/visits/photo/:token (public — token-keyed, unenumerable)',
      'POST /api/visits/:id/sign-out (public=kiosk-method, authed=admin-method, rate-limited)',
      'GET  /api/visits (admin or security)',
      'GET  /api/visits/:id (admin or security)',
      'GET  /api/visits/:id/badge (public, printable HTML)',
      'GET  /api/kiosks/:slug (public — kiosk reads its own config)',
      'GET  /api/kiosks (admin)',
      'POST /api/kiosks (admin)',
      'PATCH /api/kiosks/:slug (admin)',
      'DELETE /api/kiosks/:slug (admin — soft deactivate)',
      'GET  /api/documents/active (public — kiosk reads NDA + safety bodies)',
      'GET  /api/documents (admin — version history)',
      'POST /api/documents (admin — saves new version)',
      'DELETE /api/documents/:kind (admin — deactivate)',
      'POST /api/visitors/lookup (public — returning-visitor pre-fill + NDA cache)',
      'GET  /api/visitors (admin)',
      'GET  /api/invitations/:token (public — kiosk claim pre-fill)',
      'GET  /api/invitations (admin)',
      'POST /api/invitations (admin — sends email with QR)',
      'POST /api/invitations/:id/resend (admin)',
      'DELETE /api/invitations/:id (admin — cancel)',
      'GET  /api/bans (admin or security)',
      'POST /api/bans (admin or security)',
      'POST /api/bans/:id/lift (admin or security)',
    ],
  }));

  app.use('/api/auth', authRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/visitor-form', visitorFormRouter);
  app.use('/api/hosts', hostsRouter);
  app.use('/api/visits', visitsRouter);
  app.use('/api/kiosks', kiosksRouter);
  app.use('/api/documents', documentsRouter);
  app.use('/api/visitors', visitorsRouter);
  app.use('/api/invitations', invitationsRouter);
  app.use('/api/bans', bansRouter);

  // Serve uploaded files (logos etc.) — no auth required because the logo is public branding.
  // fallthrough:false so missing files return 404 instead of falling into the SPA catch-all.
  const uploadsDir = resolve(config.dataDir, 'uploads');
  app.use('/uploads', express.static(uploadsDir, { fallthrough: false, maxAge: '1h' }));

  const webDist = resolve(config.repoRoot, 'web/dist');
  if (existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.sendFile(resolve(webDist, 'index.html'));
    });
  }

  app.use((err, _req, res, _next) => {
    const status = err.status ?? err.statusCode ?? 500;
    if (status >= 500) {
      logger.error({ err: err.message, stack: err.stack }, 'unhandled error');
      return res.status(500).json({ error: 'internal server error' });
    }
    res.status(status).json({ error: err.message });
  });

  return app;
}
