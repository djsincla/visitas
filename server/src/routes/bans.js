import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole, blockIfPasswordChangeRequired } from '../middleware/auth.js';
import { createBan, liftBan, listAll, getById } from '../services/bans.js';

const router = Router();

// Both admin and security can manage bans — security is on the floor and
// likely the role making the call.
router.use(requireAuth, blockIfPasswordChangeRequired, requireRole('admin', 'security'));

router.get('/', (req, res) => {
  res.json({ bans: listAll({ status: req.query.status || null }) });
});

router.get('/:id', (req, res, next) => {
  const b = getById(Number(req.params.id));
  if (!b) return res.status(404).json({ error: 'ban not found' });
  res.json({ ban: b });
});

const createSchema = z.object({
  mode: z.enum(['visitor', 'email', 'name']),
  visitorId: z.number().int().positive().nullable().optional(),
  email: z.string().email().nullable().optional(),
  namePattern: z.string().min(1).max(128).nullable().optional(),
  companyPattern: z.string().min(1).max(128).nullable().optional(),
  reason: z.string().min(1).max(1024),
  // ISO 8601 string (e.g. '2026-12-31T17:00:00Z') or null for permanent.
  expiresAt: z.string().max(64).nullable().optional(),
}).strict();

router.post('/', (req, res, next) => {
  const parse = createSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'invalid request', details: parse.error.flatten() });
  try {
    const b = createBan({ ...parse.data, createdByUserId: req.user.id });
    res.status(201).json({ ban: b });
  } catch (e) { next(e); }
});

const liftSchema = z.object({
  liftReason: z.string().max(512).nullable().optional(),
}).strict();

router.post('/:id/lift', (req, res, next) => {
  const parse = liftSchema.safeParse(req.body ?? {});
  if (!parse.success) return res.status(400).json({ error: 'invalid request', details: parse.error.flatten() });
  try {
    const b = liftBan({
      id: Number(req.params.id),
      byUserId: req.user.id,
      liftReason: parse.data.liftReason ?? null,
    });
    res.json({ ban: b });
  } catch (e) { next(e); }
});

export default router;
