import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole, blockIfPasswordChangeRequired } from '../middleware/auth.js';
import { COOKIE_NAME, verifyToken } from '../auth/jwt.js';
import { db } from '../db/index.js';
import { createVisit, signOutVisit, getById, listActive, listAll, sanitizeForWall } from '../services/visits.js';

const router = Router();

const createSchema = z.object({
  visitorName: z.string().min(1).max(128),
  company: z.string().max(128).nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().max(32).nullable().optional(),
  hostUserId: z.number().int().positive(),
  purpose: z.string().max(256).nullable().optional(),
  fields: z.record(z.string(), z.any()).optional(),
});

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
    });
    res.status(201).json({ visit: v });
  } catch (e) { next(e); }
});

// Public: the wall view at /active reads this. Sanitized — names + hosts +
// signed-in timestamps only, no email/phone/purpose. Anyone on the LAN can read.
router.get('/active', (_req, res) => {
  const visits = listActive().map(sanitizeForWall);
  res.json({ visits, asOf: new Date().toISOString() });
});

// Sign-out. Public when called without auth (visitor self-signs-out at kiosk),
// admin/security when called with a valid session cookie (force sign-out).
// We try to identify the caller from the cookie but don't require auth.
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
  res.json({ visits: listAll({ status, limit: 500 }) });
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
