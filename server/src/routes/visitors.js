import { Router } from 'express';
import { z } from 'zod';
import { lookupForKiosk, listForAdmin } from '../services/visitors.js';
import { purgeVisitor } from '../services/visitorPurge.js';
import { requireAuth, requireRole, blockIfPasswordChangeRequired } from '../middleware/auth.js';

const router = Router();

const lookupSchema = z.object({
  email: z.string().email(),
});

// Public — kiosk uses this to pre-fill returning visitors. Trust-the-LAN.
router.post('/lookup', (req, res) => {
  const parse = lookupSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'invalid request' });
  const v = lookupForKiosk(parse.data.email);
  if (!v) return res.status(404).json({ error: 'visitor not found' });
  res.json({ visitor: v });
});

router.use(requireAuth, blockIfPasswordChangeRequired, requireRole('admin'));

// Admin list — every visitor we've ever seen, with derived visit count + NDA cache status.
router.get('/', (_req, res) => {
  res.json({ visitors: listForAdmin() });
});

// GDPR Art. 17 — right-to-be-forgotten purge. Admin only. Scrubs PII off
// every visit, acknowledgment, invitation, and notification-log entry the
// visitor touched, deletes their signature + photo files, and removes the
// visitors row. Visit / audit_log / ban rows survive (with PII nulled and
// visitor_id unlinked) so the workshop's signed-in/signed-out story isn't
// erased — only the personal data.
const purgeSchema = z.object({
  reason: z.string().max(512).nullable().optional(),
}).strict();

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'invalid id' });
  const parse = purgeSchema.safeParse(req.body ?? {});
  if (!parse.success) return res.status(400).json({ error: 'invalid request', details: parse.error.flatten() });

  const out = purgeVisitor({
    visitorId: id,
    actorUserId: req.user?.id ?? null,
    reason: parse.data.reason ?? null,
  });
  if (!out) return res.status(404).json({ error: 'visitor not found' });
  res.json(out);
});

export default router;
