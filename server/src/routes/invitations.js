import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole, blockIfPasswordChangeRequired } from '../middleware/auth.js';
import { createInvitation, getByToken, listAll, cancel } from '../services/invitations.js';
import { getBranding } from '../services/settings.js';
import { sendInvitationEmail } from '../notifications/invitationEmail.js';

const router = Router();

// Public — kiosk reads invitation by token to pre-fill the form. Sanitized:
// only the fields the kiosk needs. Returns 410 (gone) for expired/used/cancelled.
router.get('/:token', (req, res) => {
  const inv = getByToken(req.params.token);
  if (!inv) return res.status(404).json({ error: 'invitation not found' });
  if (inv.status !== 'sent') return res.status(410).json({ error: `invitation ${inv.status}` });

  // Sanitized: never reveal token (it's already in the URL), no audit fields,
  // limited host info.
  res.json({
    invitation: {
      visitorName: inv.visitorName,
      email: inv.email,
      company: inv.company,
      phone: inv.phone,
      host: inv.host ? { id: inv.host.id, displayName: inv.host.displayName } : null,
      kiosk: inv.kiosk,
      expectedAt: inv.expectedAt,
      purpose: inv.purpose,
    },
  });
});

// Admin endpoints below.
router.use(requireAuth, blockIfPasswordChangeRequired, requireRole('admin'));

router.get('/', (req, res) => {
  res.json({ invitations: listAll({ status: req.query.status || null }) });
});

const createSchema = z.object({
  visitorName: z.string().min(1).max(128),
  email: z.string().email(),
  company: z.string().max(128).nullable().optional(),
  phone: z.string().max(32).nullable().optional(),
  hostUserId: z.number().int().positive(),
  kioskSlug: z.string().min(1).max(64).nullable().optional(),
  expectedAt: z.string().max(64).nullable().optional(),
  purpose: z.string().max(256).nullable().optional(),
  expiryDays: z.number().int().min(1).max(90).optional(),
}).strict();

router.post('/', async (req, res, next) => {
  const parse = createSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'invalid request', details: parse.error.flatten() });
  try {
    const inv = createInvitation({ ...parse.data, createdByUserId: req.user.id });
    // Fire-and-forget email; don't block on SMTP.
    setImmediate(() => {
      sendInvitationEmail({ invitation: inv, branding: getBranding() })
        .catch(() => {});
    });
    res.status(201).json({ invitation: inv });
  } catch (e) { next(e); }
});

router.delete('/:id', (req, res, next) => {
  try {
    const inv = cancel(Number(req.params.id), req.user.id);
    res.json({ invitation: inv });
  } catch (e) { next(e); }
});

router.post('/:id/resend', async (req, res, next) => {
  try {
    const inv = listAll({}).find(i => i.id === Number(req.params.id));
    if (!inv) return res.status(404).json({ error: 'invitation not found' });
    if (inv.status !== 'sent') return res.status(409).json({ error: `cannot resend ${inv.status} invitation` });
    setImmediate(() => {
      sendInvitationEmail({ invitation: inv, branding: getBranding() })
        .catch(() => {});
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
