import { Router } from 'express';
import { z } from 'zod';
import { lookupForKiosk } from '../services/visitors.js';

const router = Router();

const lookupSchema = z.object({
  email: z.string().email(),
});

// Public — kiosk uses this to pre-fill returning visitors. Trust-the-LAN.
// Returns 404 (not 200 with null) when unknown so the kiosk can branch
// cheaply on res.ok.
router.post('/lookup', (req, res) => {
  const parse = lookupSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'invalid request' });
  const v = lookupForKiosk(parse.data.email);
  if (!v) return res.status(404).json({ error: 'visitor not found' });
  res.json({ visitor: v });
});

export default router;
