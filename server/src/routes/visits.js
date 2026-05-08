import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { requireAuth, requireRole, blockIfPasswordChangeRequired } from '../middleware/auth.js';
import { COOKIE_NAME, verifyToken } from '../auth/jwt.js';
import { db } from '../db/index.js';
import {
  createVisit, signOutVisit, getById, getByPublicToken,
  listActive, listAll, sanitizeForWall,
} from '../services/visits.js';
import { renderBadge } from '../services/badge.js';
import { photoFileFor } from '../services/photo.js';
import { getSetting } from '../services/settings.js';

const router = Router();

// Rate limit on the public sign-out path. Skipped under NODE_ENV=test so the
// existing suite (which fires sign-outs back to back) isn't perturbed.
const signOutLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too many sign-out requests, slow down' },
  skip: () => process.env.NODE_ENV === 'test',
});

const ackSchema = z.object({
  kind: z.enum(['nda', 'safety']),
  signedName: z.string().max(128).nullable().optional(),
  signaturePngBase64: z.string().max(2_000_000).nullable().optional(),
});

const createSchema = z.object({
  visitorName: z.string().min(1).max(128),
  company: z.string().max(128).nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().max(32).nullable().optional(),
  hostUserId: z.number().int().positive().optional(),
  purpose: z.string().max(256).nullable().optional(),
  fields: z.record(z.string(), z.any()).optional(),
  kioskSlug: z.string().min(1).max(64).nullable().optional(),
  acknowledgments: z.array(ackSchema).optional(),
  inviteToken: z.string().min(8).max(128).nullable().optional(),
  photoPngBase64: z.string().max(5_000_000).nullable().optional(),
}).refine(
  (data) => data.hostUserId || data.inviteToken,
  { message: 'hostUserId or inviteToken required' },
);

// Public: the kiosk creates visits without auth. Trust-the-LAN.
router.post('/', (req, res, next) => {
  const parse = createSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'invalid request', details: parse.error.flatten() });
  try {
    const v = createVisit({
      visitorName: parse.data.visitorName,
      company: parse.data.company ?? null,
      email: parse.data.email ?? null,
      phone: parse.data.phone ?? null,
      hostUserId: parse.data.hostUserId,
      purpose: parse.data.purpose ?? null,
      fields: parse.data.fields ?? {},
      kioskSlug: parse.data.kioskSlug ?? null,
      acknowledgments: parse.data.acknowledgments ?? [],
      inviteToken: parse.data.inviteToken ?? null,
      photoPngBase64: parse.data.photoPngBase64 ?? null,
    });
    res.status(201).json({ visit: v });
  } catch (e) { next(e); }
});

// Sanitized active-list — wall view at /active reads this. Public by default;
// when admins flip the wall_view.public setting off (workshops doing sensitive
// client work), the endpoint requires an admin/security session cookie.
router.get('/active', (req, res) => {
  const isPublic = getSetting('wall_view.public');
  if (isPublic === false) {
    const callerId = tryIdentifyUser(req);
    const ok = callerId
      ? db.prepare("SELECT 1 AS ok FROM users WHERE id = ? AND role IN ('admin','security') AND active = 1").get(callerId)?.ok
      : null;
    if (!ok) return res.status(401).json({ error: 'wall view requires sign-in' });
  }
  const kioskSlug = req.query.kiosk || null;
  const visits = listActive({ kioskSlug }).map(sanitizeForWall);
  res.json({ visits, asOf: new Date().toISOString() });
});

// Token-keyed badge — public, but the random 64-hex token in the URL is
// unguessable, so this can't be enumerated by walking visit ids.
router.get('/badge/:token', (req, res) => {
  const v = getByPublicToken(req.params.token);
  if (!v) return res.status(404).type('text/plain').send('visit not found');
  res.set('Cache-Control', 'private, no-store');
  res.type('text/html').send(renderBadge(v));
});

// Token-keyed photo — same deal. 404 once the retention sweep purges it.
router.get('/photo/:token', (req, res) => {
  const v = getByPublicToken(req.params.token);
  if (!v) return res.status(404).type('text/plain').send('photo not available');
  const file = photoFileFor(v.id);
  if (!file) return res.status(404).type('text/plain').send('photo not available');
  res.set('Cache-Control', 'private, no-store');
  res.type('image/png').sendFile(file);
});

// Sign-out. Public when called without auth (visitor self-signs-out at kiosk),
// admin/security when called with a valid session cookie (force sign-out).
// Rate-limited on the public path; admin/security with auth bypasses the
// limiter because their sign-outs are deliberate and audited.
router.post('/:id/sign-out', signOutLimiter, (req, res, next) => {
  const id = Number(req.params.id);
  const callerId = tryIdentifyUser(req);
  const isAdminOrSecurity = callerId
    ? db.prepare("SELECT 1 AS ok FROM users WHERE id = ? AND role IN ('admin','security') AND active = 1").get(callerId)?.ok
    : null;

  try {
    const v = signOutVisit({
      visitId: id,
      byUserId: isAdminOrSecurity ? callerId : null,
      method: isAdminOrSecurity ? 'admin' : 'kiosk',
    });
    res.json({ visit: v });
  } catch (e) { next(e); }
});

// Admin/security routes below.
router.use(requireAuth, blockIfPasswordChangeRequired, requireRole('admin', 'security'));

router.get('/', (req, res) => {
  const status = req.query.status || null;
  const kioskSlug = req.query.kiosk || null;
  res.json({ visits: listAll({ status, kioskSlug, limit: 500 }) });
});

router.get('/:id', (req, res) => {
  const v = getById(Number(req.params.id));
  if (!v) return res.status(404).json({ error: 'visit not found' });
  res.json({ visit: v });
});

function tryIdentifyUser(req) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return null;
  try {
    const payload = verifyToken(token);
    return payload.sub;
  } catch {
    return null;
  }
}

export default router;
