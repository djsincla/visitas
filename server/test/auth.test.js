import { describe, test, expect, beforeEach } from 'vitest';
import { resetDb, createUser, agentFor, client, row } from './helpers.js';

describe('POST /api/auth/login', () => {
  beforeEach(resetDb);

  test('logs in with admin/admin and sets session cookie', async () => {
    const res = await client().post('/api/auth/login').send({ username: 'admin', password: 'admin' });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      username: 'admin', role: 'admin', source: 'local', mustChangePassword: true,
    });
    const cookies = res.headers['set-cookie'] ?? [];
    expect(cookies.some(c => c.startsWith('visitas_session='))).toBe(true);
    expect(res.body.token).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
  });

  test('session cookie is HttpOnly + SameSite=Strict (CSRF defense)', async () => {
    const res = await client().post('/api/auth/login').send({ username: 'admin', password: 'admin' });
    const cookie = (res.headers['set-cookie'] ?? []).find(c => c.startsWith('visitas_session='));
    expect(cookie).toBeTruthy();
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
  });

  test('rejects bad password', async () => {
    const res = await client().post('/api/auth/login').send({ username: 'admin', password: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid credentials');
  });

  test('rejects unknown user', async () => {
    const res = await client().post('/api/auth/login').send({ username: 'nobody', password: 'whatever' });
    expect(res.status).toBe(401);
  });

  test('400 on missing fields', async () => {
    const res = await client().post('/api/auth/login').send({ username: 'admin' });
    expect(res.status).toBe(400);
  });

  test('rejects disabled local account with 403', async () => {
    createUser({ username: 'inactive', password: 'AAaa1234567', active: 0 });
    const res = await client().post('/api/auth/login').send({ username: 'inactive', password: 'AAaa1234567' });
    expect(res.status).toBe(403);
  });
});

describe('GET /api/auth/me', () => {
  beforeEach(resetDb);

  test('401 without auth', async () => {
    const res = await client().get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  test('returns the logged-in user', async () => {
    createUser({ username: 'alice', password: 'AlicePass123', email: 'alice@example.com' });
    const a = await agentFor('alice', 'AlicePass123');
    const res = await a.get('/api/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      username: 'alice', role: 'admin', email: 'alice@example.com', source: 'local',
    });
  });

  test('rejects token after logout', async () => {
    createUser({ username: 'alice', password: 'AlicePass123' });
    const a = await agentFor('alice', 'AlicePass123');
    await a.post('/api/auth/logout');
    const res = await a.get('/api/auth/me');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/change-password', () => {
  beforeEach(resetDb);

  test('admin can change password and clears must_change_password', async () => {
    const a = await agentFor('admin', 'admin');
    const res = await a.post('/api/auth/change-password')
      .send({ currentPassword: 'admin', newPassword: 'NewAdmin1234' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const after = row('SELECT must_change_password FROM users WHERE username = ?', 'admin');
    expect(after.must_change_password).toBe(0);

    const oldLogin = await client().post('/api/auth/login').send({ username: 'admin', password: 'admin' });
    expect(oldLogin.status).toBe(401);

    const newLogin = await client().post('/api/auth/login').send({ username: 'admin', password: 'NewAdmin1234' });
    expect(newLogin.status).toBe(200);
  });

  test('rejects wrong current password', async () => {
    const a = await agentFor('admin', 'admin');
    const res = await a.post('/api/auth/change-password')
      .send({ currentPassword: 'wrong', newPassword: 'NewAdmin1234' });
    expect(res.status).toBe(401);
  });

  test('rejects weak new password', async () => {
    const a = await agentFor('admin', 'admin');
    const res = await a.post('/api/auth/change-password')
      .send({ currentPassword: 'admin', newPassword: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least|upper.*lower.*number/i);
  });

  test('rejects new password missing complexity', async () => {
    const a = await agentFor('admin', 'admin');
    const res = await a.post('/api/auth/change-password')
      .send({ currentPassword: 'admin', newPassword: 'alllowercase1234' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/logout', () => {
  beforeEach(resetDb);

  test('clears the session cookie', async () => {
    const a = await agentFor('admin', 'admin');
    const res = await a.post('/api/auth/logout');
    expect(res.status).toBe(200);
    const cookies = res.headers['set-cookie'] ?? [];
    expect(cookies.some(c => /visitas_session=;/.test(c))).toBe(true);
  });
});

describe('must_change_password gate', () => {
  beforeEach(resetDb);

  test('blocks API access until password is changed', async () => {
    const a = await agentFor('admin', 'admin'); // bootstrap admin must change pw
    const res = await a.get('/api/users');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
  });

  test('allows /auth/me and /auth/change-password through the gate', async () => {
    const a = await agentFor('admin', 'admin');
    expect((await a.get('/api/auth/me')).status).toBe(200);
    expect((await a.post('/api/auth/change-password').send({ currentPassword: 'admin', newPassword: 'AAaa1234567' })).status).toBe(200);
  });
});
