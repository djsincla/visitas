import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { hashPassword, validatePasswordStrength } from '../auth/passwords.js';
import { requireAuth, requireRole, blockIfPasswordChangeRequired } from '../middleware/auth.js';
import { config } from '../config.js';

const router = Router();

// Admin-only — security users cannot manage other users.
router.use(requireAuth, blockIfPasswordChangeRequired, requireRole('admin'));

const ROLES = ['admin', 'security'];

const createSchema = z.object({
  username: z.string().min(1).max(64).regex(/^[A-Za-z0-9._-]+$/, 'username must be alphanumeric (with . _ -)'),
  password: z.string().min(1).max(1024),
  email: z.string().email().nullable().optional(),
  displayName: z.string().max(128).nullable().optional(),
  phone: z.string().max(32).nullable().optional(),
  role: z.enum(ROLES).optional(),
}).strict();

const patchSchema = z.object({
  email: z.string().email().nullable().optional(),
  displayName: z.string().max(128).nullable().optional(),
  phone: z.string().max(32).nullable().optional(),
  active: z.boolean().optional(),
  role: z.enum(ROLES).optional(),
}).strict();

const resetPasswordSchema = z.object({
  password: z.string().min(1).max(1024).optional(),
}).strict();

router.get('/', (_req, res) => {
  const rows = db.prepare(`
    SELECT id, username, email, display_name, source, role, must_change_password, active, phone, created_at, updated_at
    FROM users ORDER BY username COLLATE NOCASE
  `).all();
  res.json({ users: rows.map(rowToUser) });
});

router.post('/', async (req, res) => {
  const parse = createSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'invalid request', details: parse.error.flatten() });

  const minLen = config.auth.local?.passwordMinLength ?? 10;
  const err = validatePasswordStrength(parse.data.password, minLen);
  if (err) return res.status(400).json({ error: err });

  const exists = db.prepare('SELECT 1 FROM users WHERE username = ?').get(parse.data.username);
  if (exists) return res.status(409).json({ error: 'username already taken' });

  const role = parse.data.role ?? 'admin';
  const hash = await hashPassword(parse.data.password);
  const info = db.prepare(`
    INSERT INTO users (username, email, display_name, password_hash, source, role, must_change_password, active, phone)
    VALUES (?, ?, ?, ?, 'local', ?, 1, 1, ?)
  `).run(
    parse.data.username,
    parse.data.email ?? null,
    parse.data.displayName ?? null,
    hash,
    role,
    parse.data.phone ?? null,
  );

  const created = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ user: rowToUser(created) });
});

router.patch('/:id', (req, res) => {
  const id = Number(req.params.id);
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'user not found' });

  const parse = patchSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'invalid request', details: parse.error.flatten() });

  // Last-admin protection: refuse to deactivate or demote the only active admin.
  const wouldDeactivate = parse.data.active === false && target.active && target.role === 'admin';
  const wouldDemote = parse.data.role && parse.data.role !== 'admin' && target.role === 'admin';
  if (wouldDeactivate || wouldDemote) {
    const activeAdmins = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND active = 1").get().c;
    if (activeAdmins <= 1) {
      return res.status(409).json({ error: 'cannot disable or demote the last active admin' });
    }
  }

  const fields = [];
  const values = [];
  if ('email' in parse.data)        { fields.push('email = ?');         values.push(parse.data.email ?? null); }
  if ('displayName' in parse.data)  { fields.push('display_name = ?');  values.push(parse.data.displayName ?? null); }
  if ('phone' in parse.data)        { fields.push('phone = ?');         values.push(parse.data.phone ?? null); }
  if ('active' in parse.data)       { fields.push('active = ?');        values.push(parse.data.active ? 1 : 0); }
  if ('role' in parse.data)         { fields.push('role = ?');          values.push(parse.data.role); }
  if (!fields.length) return res.json({ user: rowToUser(target) });

  fields.push("updated_at = datetime('now')");
  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values, id);

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  res.json({ user: rowToUser(updated) });
});

router.post('/:id/reset-password', async (req, res) => {
  const id = Number(req.params.id);
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'user not found' });
  if (target.source !== 'local') return res.status(400).json({ error: 'cannot reset password for AD-sourced user' });

  const parse = resetPasswordSchema.safeParse(req.body ?? {});
  if (!parse.success) return res.status(400).json({ error: 'invalid request', details: parse.error.flatten() });

  let password = parse.data.password;
  if (password) {
    const minLen = config.auth.local?.passwordMinLength ?? 10;
    const err = validatePasswordStrength(password, minLen);
    if (err) return res.status(400).json({ error: err });
  } else {
    const { generatePassword } = await import('../cli/reset-admin.js');
    password = generatePassword();
  }

  const hash = await hashPassword(password);
  db.prepare(`
    UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = datetime('now') WHERE id = ?
  `).run(hash, id);

  res.json({ ok: true, password });
});

function rowToUser(r) {
  return {
    id: r.id,
    username: r.username,
    email: r.email,
    displayName: r.display_name,
    source: r.source,
    role: r.role,
    mustChangePassword: Boolean(r.must_change_password),
    active: Boolean(r.active),
    phone: r.phone,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export default router;
