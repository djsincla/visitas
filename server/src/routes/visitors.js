import { Router } from 'express';
import { z } from 'zod';
import { lookupForKiosk, listForAdmin } from '../services/visitors.js';
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

// Admin list — every visitor we've ever seen, with derived visit count + NDA cache status.
router.get('/', requireAuth, blockIfPasswordChangeRequired, requireRole('admin'), (_req, res) => {
  res.json({ visitors: listForAdmin() });
});

export default router;
