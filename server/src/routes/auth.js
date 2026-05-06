import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { signToken, COOKIE_NAME, cookieOptions } from '../auth/jwt.js';
import { hashPassword, verifyPassword, validatePasswordStrength } from '../auth/passwords.js';
import { config } from '../config.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const loginSchema = z.object({
  username: z.string().min(1).max(255),
  password: z.string().min(1).max(1024),
});

router.post('/login', async (req, res) => {
  const parse = loginSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'invalid request', details: parse.error.flatten() });
  const { username, password } = parse.data;

  // Local-only for v0.1. AD lookup arrives in v0.7 (visitas-world group).
  const localUser = db.prepare(
    `SELECT id, username, email, display_name, password_hash, role, source, must_change_password, active
     FROM users WHERE username = ? AND source = 'local'`,
  ).get(username);

  if (localUser && config.auth.local?.enabled !== false) {
    const ok = await verifyPassword(password, localUser.password_hash);
    if (ok && localUser.active) {
      return issueSession(res, localUser);
    }
    if (ok && !localUser.active) {
      return res.status(403).json({ error: 'account disabled' });
    }
  }

  return res.status(401).json({ error: 'invalid credentials' });
});

router.post('/logout', (_req, res) => {
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: sanitizeUser(req.user) });
});

const changePwSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1),
});

router.post('/change-password', requireAuth, async (req, res) => {
  if (req.user.source !== 'local') {
    return res.status(400).json({ error: 'AD-authenticated users must change password in AD' });
  }
  const parse = changePwSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'invalid request', details: parse.error.flatten() });

  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  const ok = await verifyPassword(parse.data.currentPassword, row.password_hash);
  if (!ok) return res.status(401).json({ error: 'current password incorrect' });

  const minLen = config.auth.local?.passwordMinLength ?? 10;
  const err = validatePasswordStrength(parse.data.newPassword, minLen);
  if (err) return res.status(400).json({ error: err });

  const hash = await hashPassword(parse.data.newPassword);
  db.prepare(`UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = datetime('now') WHERE id = ?`)
    .run(hash, req.user.id);

  res.json({ ok: true });
});

function issueSession(res, user) {
  const token = signToken(user);
  res.cookie(COOKIE_NAME, token, cookieOptions());
  return res.json({ user: sanitizeUser(user), token });
}

function sanitizeUser(u) {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    displayName: u.display_name,
    role: u.role,
    source: u.source,
    mustChangePassword: Boolean(u.must_change_password),
    phone: u.phone ?? null,
  };
}

export default router;
