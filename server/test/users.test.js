import { describe, test, expect, beforeEach } from 'vitest';
import { resetDb, agentFor, client, row } from './helpers.js';

async function adminAgent() {
  const a = await agentFor('admin', 'admin');
  await a.post('/api/auth/change-password').send({ currentPassword: 'admin', newPassword: 'AAaa1234567' });
  return a;
}

describe('GET /api/users', () => {
  beforeEach(resetDb);

  test('401 without auth', async () => {
    const res = await client().get('/api/users');
    expect(res.status).toBe(401);
  });

  test('admin can list users', async () => {
    const a = await adminAgent();
    const res = await a.get('/api/users');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.users)).toBe(true);
    expect(res.body.users.find(u => u.username === 'admin')).toBeDefined();
  });
});

describe('POST /api/users', () => {
  beforeEach(resetDb);

  test('admin can create a host', async () => {
    const a = await adminAgent();
    const res = await a.post('/api/users').send({
      username: 'alice',
      password: 'AlicePass1234',
      email: 'alice@example.com',
      displayName: 'Alice Example',
      phone: '+15555550100',
    });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({
      username: 'alice',
      email: 'alice@example.com',
      displayName: 'Alice Example',
      role: 'admin',
      source: 'local',
      mustChangePassword: true,
      active: true,
    });
    // Created hash exists.
    const r = row('SELECT password_hash FROM users WHERE username = ?', 'alice');
    expect(r.password_hash).toBeTruthy();
  });

  test('rejects duplicate username', async () => {
    const a = await adminAgent();
    await a.post('/api/users').send({ username: 'alice', password: 'AlicePass1234' });
    const res = await a.post('/api/users').send({ username: 'alice', password: 'AlicePass1234' });
    expect(res.status).toBe(409);
  });

  test('rejects weak password', async () => {
    const a = await adminAgent();
    const res = await a.post('/api/users').send({ username: 'bob', password: 'short' });
    expect(res.status).toBe(400);
  });

  test('rejects invalid username chars', async () => {
    const a = await adminAgent();
    const res = await a.post('/api/users').send({ username: 'has spaces', password: 'AlicePass1234' });
    expect(res.status).toBe(400);
  });

  test('rejects unknown fields strictly', async () => {
    const a = await adminAgent();
    const res = await a.post('/api/users').send({
      username: 'alice', password: 'AlicePass1234', surprise: true,
    });
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/users/:id', () => {
  beforeEach(resetDb);

  test('admin can edit display name + email', async () => {
    const a = await adminAgent();
    const created = await a.post('/api/users').send({ username: 'alice', password: 'AlicePass1234' });
    const id = created.body.user.id;

    const res = await a.patch(`/api/users/${id}`).send({ displayName: 'Alice A', email: 'a@x.com' });
    expect(res.status).toBe(200);
    expect(res.body.user.displayName).toBe('Alice A');
    expect(res.body.user.email).toBe('a@x.com');
  });

  test('admin can deactivate non-last admin', async () => {
    const a = await adminAgent();
    const created = await a.post('/api/users').send({ username: 'alice', password: 'AlicePass1234' });
    const id = created.body.user.id;

    const res = await a.patch(`/api/users/${id}`).send({ active: false });
    expect(res.status).toBe(200);
    expect(res.body.user.active).toBe(false);
  });

  test('refuses to deactivate last active admin', async () => {
    const a = await adminAgent();
    const adminId = row('SELECT id FROM users WHERE username = ?', 'admin').id;
    const res = await a.patch(`/api/users/${adminId}`).send({ active: false });
    expect(res.status).toBe(409);
  });

  test('404 on unknown user', async () => {
    const a = await adminAgent();
    const res = await a.patch('/api/users/9999').send({ displayName: 'x' });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/users/:id/reset-password', () => {
  beforeEach(resetDb);

  test('admin reset returns generated password', async () => {
    const a = await adminAgent();
    const created = await a.post('/api/users').send({ username: 'alice', password: 'AlicePass1234' });
    const id = created.body.user.id;

    const res = await a.post(`/api/users/${id}/reset-password`).send({});
    expect(res.status).toBe(200);
    expect(res.body.password).toMatch(/[A-Z]/);
    expect(res.body.password).toMatch(/[a-z]/);
    expect(res.body.password).toMatch(/[0-9]/);

    // The user must now change password on next login.
    const after = row('SELECT must_change_password FROM users WHERE id = ?', id);
    expect(after.must_change_password).toBe(1);
  });

  test('admin reset with explicit password works', async () => {
    const a = await adminAgent();
    const created = await a.post('/api/users').send({ username: 'alice', password: 'AlicePass1234' });
    const id = created.body.user.id;

    const res = await a.post(`/api/users/${id}/reset-password`).send({ password: 'NewPass1234' });
    expect(res.status).toBe(200);

    // New password works.
    const login = await client().post('/api/auth/login').send({ username: 'alice', password: 'NewPass1234' });
    expect(login.status).toBe(200);
  });
});
