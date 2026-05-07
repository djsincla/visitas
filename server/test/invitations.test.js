import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { resetDb, createUser, agentFor, client, adminAgent, row } from './helpers.js';
import { createInvitation, getByToken, cancel } from '../src/services/invitations.js';
import { setInvitationSenderForTests } from '../src/notifications/invitationEmail.js';
import { db } from '../src/db/index.js';

describe('Invitations — service', () => {
  beforeEach(resetDb);

  test('createInvitation generates 32-hex token and sets +7d expiry', () => {
    const host = createUser({ username: 'h', role: 'admin' });
    const inv = createInvitation({
      visitorName: 'Alice', email: 'alice@x.com', hostUserId: host.id, createdByUserId: host.id,
    });
    expect(inv.token).toMatch(/^[0-9a-f]{32}$/);
    expect(inv.status).toBe('sent');
    const expiresMs = new Date(inv.expiresAt.replace(' ', 'T') + 'Z').getTime();
    const expected = Date.now() + 7 * 86400_000;
    expect(Math.abs(expiresMs - expected)).toBeLessThan(60_000);
  });

  test('rejects unknown host', () => {
    expect(() => createInvitation({
      visitorName: 'A', email: 'a@x.com', hostUserId: 9999, createdByUserId: 1,
    })).toThrow(/unknown host/);
  });

  test('rejects security user as host', () => {
    const sec = createUser({ username: 's', role: 'security' });
    expect(() => createInvitation({
      visitorName: 'A', email: 'a@x.com', hostUserId: sec.id, createdByUserId: 1,
    })).toThrow(/host must be a host/);
  });

  test('getByToken returns null for unknown token', () => {
    expect(getByToken('deadbeef')).toBeNull();
  });

  test('lazy-expires past expires_at', () => {
    const host = createUser({ username: 'h', role: 'admin' });
    const inv = createInvitation({
      visitorName: 'A', email: 'a@x.com', hostUserId: host.id, createdByUserId: host.id,
    });
    db.prepare("UPDATE prereg_invitations SET expires_at = datetime('now', '-1 days') WHERE id = ?").run(inv.id);
    const fetched = getByToken(inv.token);
    expect(fetched.status).toBe('expired');
  });

  test('cancel works on sent, refuses on used/cancelled', () => {
    const host = createUser({ username: 'h', role: 'admin' });
    const inv = createInvitation({
      visitorName: 'A', email: 'a@x.com', hostUserId: host.id, createdByUserId: host.id,
    });
    const cancelled = cancel(inv.id, host.id);
    expect(cancelled.status).toBe('cancelled');
    expect(() => cancel(inv.id, host.id)).toThrow(/cannot cancel/);
  });
});

describe('GET /api/invitations/:token (public)', () => {
  beforeEach(resetDb);

  test('returns sanitized invitation for valid token', async () => {
    const host = createUser({ username: 'h', displayName: 'Host', role: 'admin' });
    const inv = createInvitation({
      visitorName: 'Alice', email: 'alice@x.com', company: 'ACME',
      hostUserId: host.id, purpose: 'Demo', createdByUserId: host.id,
    });
    const res = await client().get(`/api/invitations/${inv.token}`);
    expect(res.status).toBe(200);
    expect(res.body.invitation).toMatchObject({
      visitorName: 'Alice',
      email: 'alice@x.com',
      company: 'ACME',
      purpose: 'Demo',
    });
    expect(res.body.invitation.host).toMatchObject({ displayName: 'Host' });
    // Token is in URL, not echoed back.
    expect(res.body.invitation).not.toHaveProperty('token');
  });

  test('410 on used invitation', async () => {
    const host = createUser({ username: 'h', role: 'admin' });
    const inv = createInvitation({
      visitorName: 'A', email: 'a@x.com', hostUserId: host.id, createdByUserId: host.id,
    });
    db.prepare("UPDATE prereg_invitations SET status = 'used' WHERE id = ?").run(inv.id);
    const res = await client().get(`/api/invitations/${inv.token}`);
    expect(res.status).toBe(410);
  });

  test('404 on unknown token', async () => {
    const res = await client().get('/api/invitations/notreal');
    expect(res.status).toBe(404);
  });
});

describe('Admin invitations CRUD', () => {
  let captured;
  beforeEach(() => {
    resetDb();
    captured = [];
    setInvitationSenderForTests(async (msg) => { captured.push(msg); });
  });
  afterEach(() => setInvitationSenderForTests(null));

  test('admin creates → email is dispatched (best-effort)', async () => {
    const a = await adminAgent();
    const host = createUser({ username: 'jane', displayName: 'Jane', role: 'admin' });
    const res = await a.post('/api/invitations').send({
      visitorName: 'Alice', email: 'alice@x.com', hostUserId: host.id, purpose: 'Demo',
    });
    expect(res.status).toBe(201);
    expect(res.body.invitation.token).toMatch(/^[0-9a-f]{32}$/);

    await new Promise(r => setImmediate(r));
    expect(captured).toHaveLength(1);
    expect(captured[0].to).toBe('alice@x.com');
    expect(captured[0].inviteUrl).toContain(`?invite=${res.body.invitation.token}`);
  });

  test('non-admin (security) cannot create', async () => {
    createUser({ username: 'guard', password: 'GuardPass123', role: 'security' });
    const a = await agentFor('guard', 'GuardPass123');
    const host = createUser({ username: 'h', role: 'admin' });
    const res = await a.post('/api/invitations').send({
      visitorName: 'A', email: 'a@x.com', hostUserId: host.id,
    });
    expect(res.status).toBe(403);
  });

  test('admin lists invitations', async () => {
    const a = await adminAgent();
    const host = createUser({ username: 'h', role: 'admin' });
    await a.post('/api/invitations').send({ visitorName: 'A', email: 'a@x.com', hostUserId: host.id });
    await a.post('/api/invitations').send({ visitorName: 'B', email: 'b@x.com', hostUserId: host.id });
    const res = await a.get('/api/invitations');
    expect(res.body.invitations).toHaveLength(2);
  });

  test('admin cancels an invitation', async () => {
    const a = await adminAgent();
    const host = createUser({ username: 'h', role: 'admin' });
    const c = await a.post('/api/invitations').send({ visitorName: 'A', email: 'a@x.com', hostUserId: host.id });
    const res = await a.delete(`/api/invitations/${c.body.invitation.id}`);
    expect(res.status).toBe(200);
    expect(res.body.invitation.status).toBe('cancelled');
  });
});

describe('Visit creation with inviteToken', () => {
  beforeEach(resetDb);

  test('inviteToken locks host and marks invitation used + linked', async () => {
    const host = createUser({ username: 'jane', displayName: 'Jane', role: 'admin' });
    const inv = createInvitation({
      visitorName: 'Alice', email: 'alice@x.com', hostUserId: host.id, createdByUserId: host.id,
    });

    const res = await client().post('/api/visits').send({
      visitorName: 'Alice',
      inviteToken: inv.token,
      // no hostUserId — locked by invitation
    });
    expect(res.status).toBe(201);
    expect(res.body.visit.host.id).toBe(host.id);

    const after = row('SELECT status, used_visit_id FROM prereg_invitations WHERE id = ?', inv.id);
    expect(after.status).toBe('used');
    expect(after.used_visit_id).toBe(res.body.visit.id);

    const audit = row("SELECT details FROM audit_log WHERE subject_type = 'visit' AND subject_id = ?", res.body.visit.id);
    const details = JSON.parse(audit.details);
    expect(details.invitationId).toBe(inv.id);
    expect(details.source).toBe('invitation');
  });

  test('used invitation refused with 410', async () => {
    const host = createUser({ username: 'h', role: 'admin' });
    const inv = createInvitation({
      visitorName: 'A', email: 'a@x.com', hostUserId: host.id, createdByUserId: host.id,
    });
    db.prepare("UPDATE prereg_invitations SET status = 'used' WHERE id = ?").run(inv.id);

    const res = await client().post('/api/visits').send({
      visitorName: 'A', inviteToken: inv.token,
    });
    expect(res.status).toBe(410);
  });

  test('refuses request with neither hostUserId nor inviteToken', async () => {
    const res = await client().post('/api/visits').send({ visitorName: 'A' });
    expect(res.status).toBe(400);
  });
});
