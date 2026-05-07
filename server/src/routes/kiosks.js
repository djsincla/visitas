import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole, blockIfPasswordChangeRequired } from '../middleware/auth.js';
import { listKiosks, getKioskBySlug, createKiosk, patchKiosk, deactivateKiosk } from '../services/kiosks.js';

const router = Router();

// Public — kiosk reads its own config (name + default printer name) by slug.
// Sanitized: no created_at/updated_at, no id needed for the kiosk's own purposes.
router.get('/:slug', (req, res) => {
  const k = getKioskBySlug(req.params.slug);
  if (!k || !k.active) return res.status(404).json({ error: 'kiosk not found' });
  res.json({
    kiosk: {
      slug: k.slug,
      name: k.name,
      defaultPrinterName: k.defaultPrinterName,
    },
  });
});

// Admin endpoints below.
router.use(requireAuth, blockIfPasswordChangeRequired, requireRole('admin'));

router.get('/', (req, res) => {
  res.json({ kiosks: listKiosks({ activeOnly: req.query.activeOnly === 'true' }) });
});

const createSchema = z.object({
  slug: z.string().min(1).max(64),
  name: z.string().min(1).max(128),
  defaultPrinterName: z.string().max(128).nullable().optional(),
}).strict();

router.post('/', (req, res, next) => {
  const parse = createSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'invalid request', details: parse.error.flatten() });
  try {
    const k = createKiosk(parse.data);
    res.status(201).json({ kiosk: k });
  } catch (e) { next(e); }
});

const patchSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  defaultPrinterName: z.string().max(128).nullable().optional(),
  active: z.boolean().optional(),
}).strict();

router.patch('/:slug', (req, res, next) => {
  const parse = patchSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'invalid request', details: parse.error.flatten() });
  try {
    const k = patchKiosk(req.params.slug, parse.data);
    res.json({ kiosk: k });
  } catch (e) { next(e); }
});

router.delete('/:slug', (req, res, next) => {
  try {
    const k = deactivateKiosk(req.params.slug);
    res.json({ kiosk: k });
  } catch (e) { next(e); }
});

export default router;
