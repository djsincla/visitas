import { Router } from 'express';
import { requireAuth, requireRole, blockIfPasswordChangeRequired } from '../middleware/auth.js';
import { listRecent } from '../services/notificationsLog.js';

const router = Router();

// Admin only — operational debugging surface for SMTP / SMS delivery.
router.use(requireAuth, blockIfPasswordChangeRequired, requireRole('admin'));

router.get('/', (req, res) => {
  const status = req.query.status || null;
  const event = req.query.event || null;
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const validStatus = status === 'pending' || status === 'sent' || status === 'failed' ? status : null;
  res.json({ entries: listRecent({ limit, status: validStatus, event }) });
});

export default router;
