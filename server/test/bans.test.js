import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { resetDb, createUser, agentFor, client, adminAgent, row } from './helpers.js';
import { createBan, liftBan, listAll, matchActiveBan } from '../src/services/bans.js';
import { findOrCreateByEmail } from '../src/services/visitors.js';
import { db } from '../src/db/index.js';

describe('Bans — service', () => {
  beforeEach(resetDb);

  test('createBan with email mode', () => {
    const admin = createUser({ username: 'a', role: 'admin' });
    const b = createBan({
      mode: 'email', email: 'troublemaker@example.com',
      reason: 'sent abusive emails', createdByUserId: admin.id,
    });
    expect(b.mode).toBe('email');
    expect(b.active).toBe(true);
    expect(b.email).toBe('troublemaker@example.com');
  });

  test('createBan with name mode + optional company', () => {
    const admin = createUser({ username: 'a', role: 'admin' });
    const b = createBan({
      mode: 'name', namePattern: 'John Doe', companyPattern: 'ACME',
      reason: 'left without authorization', createdByUserId: admin.id,
    });
    expect(b.mode).toBe('name');
    expect(b.namePattern).toBe('John Doe');
    expect(b.companyPattern).toBe('ACME');
  });

  test('createBan with visitor mode requires existing visitor', () => {
    const admin = createUser({ username: 'a', role: 'admin' });
    expect(() => createBan({
      mode: 'visitor', visitorId: 9999,
      reason: 'unknown visitor', createdByUserId: admin.id,
    })).toThrow(/unknown visitor/);
  });

  test('createBan refuses missing reason', () => {
    const admin = createUser({ username: 'a', role: 'admin' });
    expect(() => createBan({
      mode: 'email', email: 'x@y.com', reason: '', createdByUserId: admin.id,
    })).toThrow(/reason required/);
  });

  test('liftBan flips active = 0 and records lifter', () => {
    const admin = createUser({ username: 'a', role: 'admin' });
    const b = createBan({ mode: 'email', email: 'x@y.com', reason: 'x', createdByUserId: admin.id });
    const lifted = liftBan({ id: b.id, byUserId: admin.id, liftReason: 'apologized' });
    expect(lifted.active).toBe(false);
    expect(lifted.liftReason).toBe('apologized');
    expect(lifted.liftedBy.id).toBe(admin.id);
  });

  test('liftBan refuses on already-inactive', () => {
    const admin = createUser({ username: 'a', role: 'admin' });
    const b = createBan({ mode: 'email', email: 'x@y.com', reason: 'x', createdByUserId: admin.id });
    liftBan({ id: b.id, byUserId: admin.id });
    expect(() => liftBan({ id: b.id, byUserId: admin.id })).toThrow(/not active/);
  });

  test('lazy-expires past expires_at on read', () => {
    const admin = createUser({ username: 'a', role: 'admin' });
    const b = createBan({
      mode: 'email', email: 'x@y.com', reason: 'x',
      expiresAt: '2020-01-01', createdByUserId: admin.id,
    });
    // Triggers lazy-expire.
    listAll();
    const row = db.prepare('SELECT active FROM visitor_bans WHERE id = ?').get(b.id);
    expect(row.active).toBe(0);
  });
});

describe('Bans — match logic', () => {
  beforeEach(resetDb);

  test('email mode: case-insensitive exact match', () => {
    const admin = createUser({ username: 'a', role: 'admin' });
    createBan({ mode: 'email', email: 'troublemaker@x.com', reason: 'x', createdByUserId: admin.id });
    expect(matchActiveBan({ email: 'TROUBLEMAKER@x.com', visitorName: 'Anyone' })).toBeTruthy();
    expect(matchActiveBan({ email: 'fine@x.com', visitorName: 'Anyone' })).toBeNull();
  });

  test('name mode: case-insensitive substring on name + company', () => {
    const admin = createUser({ username: 'a', role: 'admin' });
    createBan({
      mode: 'name', namePattern: 'John Doe', companyPattern: 'ACME',
      reason: 'x', createdByUserId: admin.id,
    });
    expect(matchActiveBan({ visitorName: 'Mr John Doe Jr', company: 'ACME inc.' })).toBeTruthy();
    expect(matchActiveBan({ visitorName: 'John Doe', company: 'OtherCo' })).toBeNull();
    expect(matchActiveBan({ visitorName: 'Jane Doe', company: 'ACME' })).toBeNull();
  });

  test('visitor mode: matches by visitor_id and by name fallback', () => {
    const admin = createUser({ username: 'a', role: 'admin' });
    const v = findOrCreateByEmail({ email: 'alice@x.com', name: 'Alice', company: 'ACME' });
    createBan({
      mode: 'visitor', visitorId: v.visitor.id,
      reason: 'rude', createdByUserId: admin.id,
    });
    // Direct match by visitor id.
    expect(matchActiveBan({ visitorId: v.visitor.id, visitorName: 'Alice' })).toBeTruthy();
    // By-name fallback when visitor reappears with same name+company but no email.
    expect(matchActiveBan({ visitorId: null, visitorName: 'Alice', company: 'ACME' })).toBeTruthy();
    // Different name → no match.
    expect(matchActiveBan({ visitorId: null, visitorName: 'Bob', company: 'ACME' })).toBeNull();
  });

  test('inactive ban does not match', () => {
    const admin = createUser({ username: 'a', role: 'admin' });
    const b = createBan({ mode: 'email', email: 'x@y.com', reason: 'x', createdByUserId: admin.id });
    liftBan({ id: b.id, byUserId: admin.id });
    expect(matchActiveBan({ email: 'x@y.com', visitorName: 'Whoever' })).toBeNull();
  });
});

describe('Visit creation gates on active bans', () => {
  beforeEach(resetDb);

  test('banned email → 403, no visit row, audit row written', async () => {
    const admin = createUser({ username: 'a', role: 'admin' });
    createBan({ mode: 'email', email: 'troublemaker@x.com', reason: 'reasons', createdByUserId: admin.id });
    const host = createUser({ username: 'h', role: 'admin' });

    const res = await client().post('/api/visits').send({
      visitorName: 'Bob', email: 'troublemaker@x.com', hostUserId: host.id,
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Sign-in not permitted/);
    // Body deliberately doesn't reveal the reason.
    expect(res.body.error).not.toMatch(/reasons/);

    // No visit row.
    const visits = db.prepare("SELECT COUNT(*) AS c FROM visits").get();
    expect(visits.c).toBe(0);

    // Audit row exists.
    const audit = row("SELECT * FROM audit_log WHERE action = 'visit_signin_blocked'");
    expect(audit).toBeTruthy();
    const details = JSON.parse(audit.details);
    expect(details.email).toBe('troublemaker@x.com');
    expect(details.banMode).toBe('email');
  });

  test('banned name pattern blocks emailless walk-in', async () => {
    const admin = createUser({ username: 'a', role: 'admin' });
    createBan({
      mode: 'name', namePattern: 'John Doe', companyPattern: 'ACME',
      reason: 'x', createdByUserId: admin.id,
    });
    const host = createUser({ username: 'h', role: 'admin' });

    const res = await client().post('/api/visits').send({
      visitorName: 'John Doe', company: 'ACME', hostUserId: host.id,
    });
    expect(res.status).toBe(403);
  });

  test('non-banned visitor with same surname as banned passes', async () => {
    const admin = createUser({ username: 'a', role: 'admin' });
    createBan({
      mode: 'name', namePattern: 'John Doe',
      reason: 'x', createdByUserId: admin.id,
    });
    const host = createUser({ username: 'h', role: 'admin' });

    const res = await client().post('/api/visits').send({
      visitorName: 'Jane Smith', hostUserId: host.id,
    });
    expect(res.status).toBe(201);
  });

  test('banned visitor with valid invitation is still blocked (ban beats invitation)', async () => {
    const admin = createUser({ username: 'a', role: 'admin' });
    const host = createUser({ username: 'h', role: 'admin' });
    createBan({ mode: 'email', email: 'banned@x.com', reason: 'x', createdByUserId: admin.id });

    // Pre-register a visitor with the banned email.
    const { createInvitation } = await import('../src/services/invitations.js');
    const inv = createInvitation({
      visitorName: 'Bob', email: 'banned@x.com',
      hostUserId: host.id, createdByUserId: admin.id,
    });

    const res = await client().post('/api/visits').send({
      visitorName: 'Bob', inviteToken: inv.token,
    });
    expect(res.status).toBe(403);

    // Invitation should NOT be marked used (the ban gate runs after token
    // validation but before insert + markUsed).
    const after = db.prepare('SELECT status FROM prereg_invitations WHERE id = ?').get(inv.id);
    expect(after.status).toBe('sent');
  });
});

describe('Bans API — admin and security can both manage', () => {
  beforeEach(resetDb);

  test('admin can create + list + lift', async () => {
    const a = await adminAgent();
    const c = await a.post('/api/bans').send({
      mode: 'email', email: 'x@y.com', reason: 'spam',
    });
    expect(c.status).toBe(201);

    const list = await a.get('/api/bans');
    expect(list.body.bans).toHaveLength(1);

    const lifted = await a.post(`/api/bans/${c.body.ban.id}/lift`).send({ liftReason: 'apologized' });
    expect(lifted.status).toBe(200);
    expect(lifted.body.ban.active).toBe(false);
  });

  test('security can also create + list + lift', async () => {
    const a = await adminAgent();
    await a.post('/api/users').send({
      username: 'guard', password: 'GuardPass1234', role: 'security',
    });
    const guard = await agentFor('guard', 'GuardPass1234');
    await guard.post('/api/auth/change-password').send({
      currentPassword: 'GuardPass1234', newPassword: 'GuardNewPass1234',
    });

    const c = await guard.post('/api/bans').send({
      mode: 'email', email: 'x@y.com', reason: 'rude at reception',
    });
    expect(c.status).toBe(201);

    const list = await guard.get('/api/bans');
    expect(list.body.bans).toHaveLength(1);
  });

  test('unauthed cannot manage bans', async () => {
    const res = await client().post('/api/bans').send({
      mode: 'email', email: 'x@y.com', reason: 'x',
    });
    expect(res.status).toBe(401);
  });
});
