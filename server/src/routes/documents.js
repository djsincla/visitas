import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole, blockIfPasswordChangeRequired } from '../middleware/auth.js';
import { listAll, getActiveAll, saveDocument, deactivate } from '../services/documents.js';

const router = Router();

// Public: kiosk reads active docs to render NDA + safety screens.
// Sanitized to only id, kind, version, title, body — no audit fields.
router.get('/active', (_req, res) => {
  const docs = getActiveAll().map(d => ({
    id: d.id,
    kind: d.kind,
    version: d.version,
    title: d.title,
    body: d.body,
  }));
  res.json({ documents: docs });
});

// Admin endpoints below.
router.use(requireAuth, blockIfPasswordChangeRequired, requireRole('admin'));

router.get('/', (req, res) => {
  res.json({ documents: listAll({ kind: req.query.kind || null }) });
});

const saveSchema = z.object({
  kind: z.enum(['nda', 'safety']),
  title: z.string().min(1).max(256),
  body: z.string().max(50_000),
}).strict();

router.post('/', (req, res, next) => {
  const parse = saveSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'invalid request', details: parse.error.flatten() });
  try {
    const d = saveDocument(parse.data);
    res.status(201).json({ document: d });
  } catch (e) { next(e); }
});

router.delete('/:kind', (req, res, next) => {
  try {
    const d = deactivate(req.params.kind);
    res.json({ document: d });
  } catch (e) { next(e); }
});

export default router;
