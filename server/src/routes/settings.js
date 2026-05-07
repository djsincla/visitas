import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { mkdirSync, unlinkSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { requireAuth, requireRole, blockIfPasswordChangeRequired } from '../middleware/auth.js';
import { getBranding, setSetting, clearSetting, getSetting } from '../services/settings.js';

const router = Router();

const UPLOAD_DIR = resolve(config.dataDir, 'uploads');
mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_MIME = new Set(['image/png', 'image/svg+xml', 'image/jpeg', 'image/webp']);
const ALLOWED_EXT = new Set(['.png', '.svg', '.jpg', '.jpeg', '.webp']);
const MAX_BYTES = 1 * 1024 * 1024; // 1 MB

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename(_req, file, cb) {
      const ext = extname(file.originalname).toLowerCase();
      cb(null, `logo-${randomBytes(8).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter(_req, file, cb) {
    const ext = extname(file.originalname).toLowerCase();
    if (!ALLOWED_MIME.has(file.mimetype) || !ALLOWED_EXT.has(ext)) {
      return cb(new Error('only PNG, SVG, JPEG, or WebP are allowed'));
    }
    cb(null, true);
  },
});

// Branding GET is intentionally PUBLIC — the login screen and kiosk render before auth.
router.get('/branding', (_req, res) => {
  res.json(getBranding());
});

// Authed endpoints below.
router.use(requireAuth, blockIfPasswordChangeRequired);

const brandingSchema = z.object({
  appName: z.string().min(1).max(64).optional(),
}).strict();

router.put('/branding', requireRole('admin'), (req, res) => {
  const parse = brandingSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'invalid request', details: parse.error.flatten() });
  if ('appName' in parse.data) setSetting('branding.app_name', parse.data.appName);
  res.json(getBranding());
});

router.post('/branding/logo', requireRole('admin'), (req, res) => {
  upload.single('logo')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'no file uploaded' });

    const prev = getSetting('branding.logo_path');
    if (prev && typeof prev === 'string' && prev.startsWith('/uploads/')) {
      const prevPath = resolve(UPLOAD_DIR, prev.slice('/uploads/'.length));
      if (existsSync(prevPath) && prevPath.startsWith(UPLOAD_DIR)) {
        try { unlinkSync(prevPath); } catch {}
      }
    }
    const url = `/uploads/${req.file.filename}`;
    setSetting('branding.logo_path', url);
    res.json(getBranding());
  });
});

router.delete('/branding/logo', requireRole('admin'), (_req, res) => {
  const prev = getSetting('branding.logo_path');
  if (prev && typeof prev === 'string' && prev.startsWith('/uploads/')) {
    const prevPath = resolve(UPLOAD_DIR, prev.slice('/uploads/'.length));
    if (existsSync(prevPath) && prevPath.startsWith(UPLOAD_DIR)) {
      try { unlinkSync(prevPath); } catch {}
    }
  }
  clearSetting('branding.logo_path');
  res.json(getBranding());
});

// --- Photo capture toggle (admin only) ------------------------------------

const photoSchema = z.object({ enabled: z.boolean() }).strict();

router.get('/photo', (_req, res) => {
  res.json({ enabled: Boolean(getSetting('photo.enabled')) });
});

router.put('/photo', requireRole('admin'), (req, res) => {
  const parse = photoSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'invalid request', details: parse.error.flatten() });
  setSetting('photo.enabled', parse.data.enabled);
  res.json({ enabled: parse.data.enabled });
});

// --- Notification test endpoints (admin only) -----------------------------

const testEmailSchema = z.object({ to: z.string().email() }).strict();
router.post('/email/test', requireRole('admin'), async (req, res) => {
  const parse = testEmailSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'invalid request', details: parse.error.flatten() });

  const { sendEmail, emailEnabled } = await import('../notifications/email.js');
  if (!emailEnabled()) {
    return res.status(400).json({ ok: false, error: 'email channel is disabled in config/notifications.json' });
  }
  try {
    await sendEmail({
      to: parse.data.to,
      subject: '[visitas.world] Test email',
      text: 'This is a test email from visitas.world. If you got this, your SMTP configuration is working.',
      html: '<p>This is a test email from <strong>visitas.world</strong>.</p><p>If you got this, your SMTP configuration is working.</p>',
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

const testSmsSchema = z.object({ to: z.string().min(3).max(32) }).strict();
router.post('/sms/test', requireRole('admin'), async (req, res) => {
  const parse = testSmsSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'invalid request', details: parse.error.flatten() });

  const { sendSms, smsEnabled } = await import('../notifications/sms.js');
  if (!smsEnabled()) {
    return res.status(400).json({ ok: false, error: 'sms channel is disabled in config/notifications.json' });
  }
  try {
    await sendSms({
      to: parse.data.to,
      body: '[visitas.world] Test SMS — if you got this, your SMS adapter is working.',
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
