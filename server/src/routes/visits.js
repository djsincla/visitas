import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole, blockIfPasswordChangeRequired } from '../middleware/auth.js';
import { COOKIE_NAME, verifyToken } from '../auth/jwt.js';
import { db } from '../db/index.js';
import { createVisit, signOutVisit, getById, listActive, listAll, sanitizeForWall } from '../services/visits.js';
import { renderBadge } from '../services/badge.js';

const router = Router();

const ackSchema = z.object({
  kind: z.enum(['nda', 'safety']),
  signedName: z.string().max(128).nullable().optional(),
  // PNG data URL or raw base64. Capped well above expected signature size
  // but well below DOS-as-input territory.
  signaturePngBase64: z.string().max(2_000_000).nullable().optional(),
});

const createSchema = z.object({
  visitorName: z.string().min(1).max(128),
  company: z.string().max(128).nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().max(32).nullable().optional(),
  // hostUserId is optional when inviteToken is supplied (server locks host to the invitation).
  hostUserId: z.number().int().positive().optional(),
  purpose: z.string().max(256).nullable().optional(),
  fields: z.record(z.string(), z.any()).optional(),
  kioskSlug: z.string().min(1).max(64).nullable().optional(),
  acknowledgments: z.array(ackSchema).optional(),
  inviteToken: z.string().min(8).max(128).nullable().optional(),
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
    });
    res.status(201).json({ visit: v });
  } catch (e) { next(e); }
});

// Public, sanitized — wall view at /active. Filterable by kiosk slug for
// per-entrance fire roster.
router.get('/active', (req, res) => {
  const kioskSlug = req.query.kiosk || null;
  const visits = listActive({ kioskSlug }).map(sanitizeForWall);
  res.json({ visits, asOf: new Date().toISOString() });
});

// Printable badge — public (it's a single visit's printable HTML; no PII
// risk beyond what the visitor just typed). Returns standalone HTML so the
// kiosk can window.print() it after sign-in.
router.get('/:id/badge', (req, res) => {
  const v = getById(Number(req.params.id));
  if (!v) return res.status(404).type('text/plain').send('visit not found');
  res.type('text/html').send(renderBadge(v));
});

// Sign-out. Public when called without auth (visitor self-signs-out at kiosk),
// admin/security when called with a valid session cookie (force sign-out).
router.post('/:id/sign-out', (req, res, next) => {
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
