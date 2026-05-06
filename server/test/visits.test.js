import { describe, test, expect, beforeEach } from 'vitest';
import { resetDb, createUser, agentFor, client, adminAgent, row, rows } from './helpers.js';

function seedHost(username = 'host1', displayName = 'Host One') {
  return createUser({ username, password: 'HostPass1234', displayName, role: 'admin' });
}

describe('GET /api/hosts (public)', () => {
  beforeEach(resetDb);

  test('lists active admin users only', async () => {
    seedHost('host1', 'Host One');
    seedHost('host2', 'Host Two');
    createUser({ username: 'sec', password: 'SecPass12345', role: 'security' });
    createUser({ username: 'inactive', password: 'XxXxXxXx12', active: 0 });

    const res = await client().get('/api/hosts');
    expect(res.status).toBe(200);
    const usernames = res.body.hosts.map(h => h.displayName);
    expect(usernames).toContain('Host One');
    expect(usernames).toContain('Host Two');
    // The bootstrap admin from resetDb has display_name 'Administrator'.
    expect(usernames).toContain('Administrator');
    // Security users are not hosts.
    expect(usernames.includes('sec')).toBe(false);
    // Inactive users are not hosts.
    expect(usernames.find(u => u === 'inactive')).toBeUndefined();
  });

  test('does not require auth', async () => {
    const res = await client().get('/api/hosts');
    expect(res.status).toBe(200);
  });

  test('returns no email/phone/role (sanitized)', async () => {
    seedHost('host1', 'Host One');
    const res = await client().get('/api/hosts');
    const h = res.body.hosts[0];
    expect(h).not.toHaveProperty('email');
    expect(h).not.toHaveProperty('phone');
    expect(h).not.toHaveProperty('role');
  });
});

describe('GET /api/visitor-form (public)', () => {
  beforeEach(resetDb);

  test('returns the schema', async () => {
    const res = await client().get('/api/visitor-form');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.fields)).toBe(true);
    expect(res.body.fields.length).toBeGreaterThan(0);
  });

  test('strips $comment helper keys', async () => {
    const res = await client().get('/api/visitor-form');
    for (const f of res.body.fields) {
      expect(f).not.toHaveProperty('$comment');
    }
  });
});

describe('POST /api/visits (public — kiosk sign-in)', () => {
  beforeEach(resetDb);

  test('creates a visit', async () => {
    const host = seedHost();
    const res = await client().post('/api/visits').send({
      visitorName: 'Alice Doe',
      company: 'ACME',
      hostUserId: host.id,
      purpose: 'Meeting',
    });
    expect(res.status).toBe(201);
    expect(res.body.visit).toMatchObject({
      visitorName: 'Alice Doe',
      company: 'ACME',
      status: 'on_site',
      purpose: 'Meeting',
    });
    expect(res.body.visit.host.id).toBe(host.id);
  });

  test('writes a visit_signed_in audit row', async () => {
    const host = seedHost();
    const res = await client().post('/api/visits').send({
      visitorName: 'Alice', hostUserId: host.id,
    });
    const audit = row('SELECT * FROM audit_log WHERE subject_type = ? AND subject_id = ?', 'visit', res.body.visit.id);
    expect(audit.action).toBe('visit_signed_in');
    expect(audit.user_id).toBeNull(); // public kiosk submission
  });

  test('does not require auth', async () => {
    const host = seedHost();
    const res = await client().post('/api/visits').send({
      visitorName: 'Alice', hostUserId: host.id,
    });
    expect(res.status).toBe(201);
  });

  test('refuses unknown host', async () => {
    const res = await client().post('/api/visits').send({
      visitorName: 'Alice', hostUserId: 9999,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unknown host/);
  });

  test('refuses security user as host', async () => {
    const sec = createUser({ username: 'sec', password: 'SecPass12345', role: 'security' });
    const res = await client().post('/api/visits').send({
      visitorName: 'Alice', hostUserId: sec.id,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/host must be a host/);
  });

  test('refuses inactive host', async () => {
    const host = createUser({ username: 'h', password: 'AAaa1234567', role: 'admin', active: 0 });
    const res = await client().post('/api/visits').send({
      visitorName: 'Alice', hostUserId: host.id,
    });
    expect(res.status).toBe(400);
  });

  test('400 on missing required fields', async () => {
    const res = await client().post('/api/visits').send({ visitorName: 'Alice' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/visits/active (public — wall view)', () => {
  beforeEach(resetDb);

  test('returns sanitized active visits', async () => {
    const host = seedHost('host1', 'Mary Host');
    await client().post('/api/visits').send({
      visitorName: 'Alice', email: 'alice@example.com', phone: '+15555550100',
      purpose: 'Meeting', hostUserId: host.id,
    });

    const res = await client().get('/api/visits/active');
    expect(res.status).toBe(200);
    expect(res.body.visits).toHaveLength(1);
    const v = res.body.visits[0];
    expect(v).toHaveProperty('visitorName', 'Alice');
    expect(v).toHaveProperty('hostName', 'Mary Host');
    expect(v).toHaveProperty('signedInAt');
    // Sanitized — no email, phone, purpose.
    expect(v).not.toHaveProperty('email');
    expect(v).not.toHaveProperty('phone');
    expect(v).not.toHaveProperty('purpose');
    expect(res.body).toHaveProperty('asOf');
  });

  test('excludes signed-out visits', async () => {
    const host = seedHost();
    const create = await client().post('/api/visits').send({ visitorName: 'Alice', hostUserId: host.id });
    await client().post(`/api/visits/${create.body.visit.id}/sign-out`);
    const res = await client().get('/api/visits/active');
    expect(res.body.visits).toHaveLength(0);
  });
});

describe('POST /api/visits/:id/sign-out', () => {
  beforeEach(resetDb);

  test('public call records kiosk method', async () => {
    const host = seedHost();
    const c = await client().post('/api/visits').send({ visitorName: 'Alice', hostUserId: host.id });
    const id = c.body.visit.id;

    const res = await client().post(`/api/visits/${id}/sign-out`);
    expect(res.status).toBe(200);
    expect(res.body.visit.status).toBe('signed_out');
    expect(res.body.visit.signedOutMethod).toBe('kiosk');
    expect(res.body.visit.signedOutBy).toBeNull();

    const audits = rows('SELECT * FROM audit_log WHERE subject_id = ? ORDER BY id', id);
    expect(audits.map(a => a.action)).toEqual(['visit_signed_in', 'visit_signed_out']);
  });

  test('admin call records admin method + actor', async () => {
    const host = seedHost();
    const c = await client().post('/api/visits').send({ visitorName: 'Alice', hostUserId: host.id });
    const id = c.body.visit.id;

    const a = await adminAgent();
    const res = await a.post(`/api/visits/${id}/sign-out`);
    expect(res.status).toBe(200);
    expect(res.body.visit.signedOutMethod).toBe('admin');
    expect(res.body.visit.signedOutBy).toBeGreaterThan(0);

    const audit = row('SELECT * FROM audit_log WHERE subject_id = ? AND action = ?', id, 'visit_force_signed_out');
    expect(audit.user_id).toBeGreaterThan(0);
  });

  test('security role can force-sign-out', async () => {
    const host = seedHost();
    createUser({ username: 'guard', password: 'GuardPass123', role: 'security' });
    const c = await client().post('/api/visits').send({ visitorName: 'Alice', hostUserId: host.id });
    const id = c.body.visit.id;

    const a = await agentFor('guard', 'GuardPass123');
    const res = await a.post(`/api/visits/${id}/sign-out`);
    expect(res.status).toBe(200);
    expect(res.body.visit.signedOutMethod).toBe('admin');
  });

  test('refuses double sign-out', async () => {
    const host = seedHost();
    const c = await client().post('/api/visits').send({ visitorName: 'Alice', hostUserId: host.id });
    const id = c.body.visit.id;
    await client().post(`/api/visits/${id}/sign-out`);
    const res = await client().post(`/api/visits/${id}/sign-out`);
    expect(res.status).toBe(409);
  });

  test('404 on unknown id', async () => {
    const res = await client().post('/api/visits/99999/sign-out');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/visits and GET /api/visits/:id (admin or security)', () => {
  beforeEach(resetDb);

  test('admin can list with full details', async () => {
    const host = seedHost();
    await client().post('/api/visits').send({
      visitorName: 'Alice', email: 'a@x.com', phone: '+15555', purpose: 'Meeting', hostUserId: host.id,
    });
    const a = await adminAgent();
    const res = await a.get('/api/visits');
    expect(res.status).toBe(200);
    expect(res.body.visits).toHaveLength(1);
    expect(res.body.visits[0].email).toBe('a@x.com');
    expect(res.body.visits[0].phone).toBe('+15555');
    expect(res.body.visits[0].purpose).toBe('Meeting');
  });

  test('security role can list', async () => {
    const host = seedHost();
    createUser({ username: 'guard', password: 'GuardPass123', role: 'security' });
    await client().post('/api/visits').send({ visitorName: 'Alice', hostUserId: host.id });

    const a = await agentFor('guard', 'GuardPass123');
    const res = await a.get('/api/visits');
    expect(res.status).toBe(200);
    expect(res.body.visits).toHaveLength(1);
  });

  test('unauthed call refused', async () => {
    const res = await client().get('/api/visits');
    expect(res.status).toBe(401);
  });
});

describe('Role boundary — security cannot reach admin-only routes', () => {
  beforeEach(resetDb);

  test('security cannot list users', async () => {
    createUser({ username: 'guard', password: 'GuardPass123', role: 'security' });
    const a = await agentFor('guard', 'GuardPass123');
    const res = await a.get('/api/users');
    expect(res.status).toBe(403);
  });

  test('security cannot edit branding', async () => {
    createUser({ username: 'guard', password: 'GuardPass123', role: 'security' });
    const a = await agentFor('guard', 'GuardPass123');
    const res = await a.put('/api/settings/branding').send({ appName: 'Hijack' });
    expect(res.status).toBe(403);
  });
});
