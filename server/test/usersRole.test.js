import { describe, test, expect, beforeEach } from 'vitest';
import { resetDb, adminAgent, row } from './helpers.js';

describe('Users CRUD with role split', () => {
  beforeEach(resetDb);

  test('admin can create a security user', async () => {
    const a = await adminAgent();
    const res = await a.post('/api/users').send({
      username: 'guard', password: 'GuardPass123', displayName: 'Guard One', role: 'security',
    });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('security');
  });

  test('admin can promote a security user to admin', async () => {
    const a = await adminAgent();
    const c = await a.post('/api/users').send({
      username: 'guard', password: 'GuardPass123', role: 'security',
    });
    const res = await a.patch(`/api/users/${c.body.user.id}`).send({ role: 'admin' });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('admin');
  });

  test('admin can demote a non-last admin to security', async () => {
    const a = await adminAgent();
    const c = await a.post('/api/users').send({
      username: 'h2', password: 'AAaa1234567', role: 'admin',
    });
    const res = await a.patch(`/api/users/${c.body.user.id}`).send({ role: 'security' });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('security');
  });

  test('refuses to demote the last active admin', async () => {
    const a = await adminAgent();
    const adminId = row("SELECT id FROM users WHERE username = 'admin'").id;
    const res = await a.patch(`/api/users/${adminId}`).send({ role: 'security' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/last active admin/);
  });

  test('default role on create is admin (host) when omitted', async () => {
    const a = await adminAgent();
    const res = await a.post('/api/users').send({
      username: 'someone', password: 'Pass12345678',
    });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('admin');
  });

  test('rejects unknown role', async () => {
    const a = await adminAgent();
    const res = await a.post('/api/users').send({
      username: 'someone', password: 'Pass12345678', role: 'superuser',
    });
    expect(res.status).toBe(400);
  });
});
