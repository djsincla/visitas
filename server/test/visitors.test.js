import { describe, test, expect, beforeEach } from 'vitest';
import { resetDb, createUser, client, row, rows } from './helpers.js';
import { saveDocument } from '../src/services/documents.js';
import { findOrCreateByEmail, findByEmail, computeNdaCache } from '../src/services/visitors.js';
import { db } from '../src/db/index.js';

const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

describe('Visitors — service', () => {
  beforeEach(resetDb);

  test('findOrCreateByEmail creates on first call', () => {
    const r = findOrCreateByEmail({ email: 'alice@example.com', name: 'Alice', company: 'ACME' });
    expect(r.isReturning).toBe(false);
    expect(r.visitor.id).toBeGreaterThan(0);
    expect(r.visitor.email).toBe('alice@example.com');
  });

  test('case-insensitive lookup on returning', () => {
    findOrCreateByEmail({ email: 'Alice@Example.com', name: 'Alice' });
    const r = findOrCreateByEmail({ email: 'alice@EXAMPLE.com', name: 'Alice Smith' });
    expect(r.isReturning).toBe(true);
    expect(r.visitor.name).toBe('Alice Smith'); // updates name to most recent
  });

  test('returning visitor refreshes last_seen_at', () => {
    const a = findOrCreateByEmail({ email: 'a@x.com', name: 'A' });
    db.prepare("UPDATE visitors SET last_seen_at = '2020-01-01' WHERE id = ?").run(a.visitor.id);
    findOrCreateByEmail({ email: 'a@x.com', name: 'A' });
    const after = row('SELECT last_seen_at FROM visitors WHERE id = ?', a.visitor.id);
    expect(after.last_seen_at).not.toBe('2020-01-01');
  });

  test('findByEmail is case-insensitive', () => {
    findOrCreateByEmail({ email: 'BoB@x.com', name: 'Bob' });
    expect(findByEmail('bob@x.com')).toBeTruthy();
    expect(findByEmail('BOB@x.com')).toBeTruthy();
  });

  test('emailless visitor not in visitors table', () => {
    findOrCreateByEmail({ email: null, name: 'Ghost' });
    // null email path: still creates a row, but no email FK matching
    const v = rows('SELECT * FROM visitors WHERE name = ?', 'Ghost');
    expect(v).toHaveLength(1);
    expect(v[0].email).toBeNull();
  });
});

describe('NDA cache logic', () => {
  beforeEach(resetDb);

  test('no NDA active = cache fresh = false', () => {
    const v = findOrCreateByEmail({ email: 'a@x.com', name: 'Alice' });
    expect(computeNdaCache(v.visitor.id).fresh).toBe(false);
  });

  test('no prior ack = cache fresh = false', () => {
    saveDocument({ kind: 'nda', title: 'NDA', body: 'V1' });
    const v = findOrCreateByEmail({ email: 'a@x.com', name: 'Alice' });
    expect(computeNdaCache(v.visitor.id).fresh).toBe(false);
  });

  test('recent ack = fresh', () => {
    saveDocument({ kind: 'nda', title: 'NDA', body: 'V1' });
    const host = createUser({ username: 'h', role: 'admin' });
    const create = client().post('/api/visits').send({
      visitorName: 'Alice', email: 'a@x.com', hostUserId: host.id,
      acknowledgments: [{ kind: 'nda', signedName: 'Alice', signaturePngBase64: TINY_PNG }],
    });
    return create.then(() => {
      const v = findByEmail('a@x.com');
      expect(computeNdaCache(v.id).fresh).toBe(true);
    });
  });

  test('NDA version bump invalidates cache', async () => {
    saveDocument({ kind: 'nda', title: 'NDA', body: 'V1' });
    const host = createUser({ username: 'h', role: 'admin' });
    await client().post('/api/visits').send({
      visitorName: 'Alice', email: 'a@x.com', hostUserId: host.id,
      acknowledgments: [{ kind: 'nda', signedName: 'Alice', signaturePngBase64: TINY_PNG }],
    });

    saveDocument({ kind: 'nda', title: 'NDA', body: 'V2 different' }); // bumps to v2

    const v = findByEmail('a@x.com');
    expect(computeNdaCache(v.id).fresh).toBe(false);
  });

  test('ack older than 365 days is stale', async () => {
    saveDocument({ kind: 'nda', title: 'NDA', body: 'V1' });
    const host = createUser({ username: 'h', role: 'admin' });
    const create = await client().post('/api/visits').send({
      visitorName: 'Alice', email: 'a@x.com', hostUserId: host.id,
      acknowledgments: [{ kind: 'nda', signedName: 'Alice', signaturePngBase64: TINY_PNG }],
    });
    db.prepare("UPDATE visit_acknowledgments SET acknowledged_at = datetime('now', '-400 days') WHERE visit_id = ?")
      .run(create.body.visit.id);

    const v = findByEmail('a@x.com');
    expect(computeNdaCache(v.id).fresh).toBe(false);
  });
});

describe('POST /api/visitors/lookup (public)', () => {
  beforeEach(resetDb);

  test('404 on unknown email', async () => {
    const res = await client().post('/api/visitors/lookup').send({ email: 'nobody@x.com' });
    expect(res.status).toBe(404);
  });

  test('returns visitor + ndaCacheFresh on hit', async () => {
    saveDocument({ kind: 'nda', title: 'NDA', body: 'V1' });
    const host = createUser({ username: 'h', role: 'admin' });
    await client().post('/api/visits').send({
      visitorName: 'Alice', email: 'a@x.com', company: 'ACME', phone: '+15555550100',
      hostUserId: host.id,
      acknowledgments: [{ kind: 'nda', signedName: 'Alice', signaturePngBase64: TINY_PNG }],
    });

    const res = await client().post('/api/visitors/lookup').send({ email: 'a@x.com' });
    expect(res.status).toBe(200);
    expect(res.body.visitor).toMatchObject({
      name: 'Alice',
      company: 'ACME',
      phone: '+15555550100',
      email: 'a@x.com',
      isReturning: true,
      ndaCacheFresh: true,
      ndaCacheVersion: 1,
    });
    expect(res.body.visitor.ndaCacheAcknowledgedAt).toBeTruthy();
  });

  test('case-insensitive lookup', async () => {
    const host = createUser({ username: 'h', role: 'admin' });
    await client().post('/api/visits').send({
      visitorName: 'Bob', email: 'BoB@x.com', hostUserId: host.id,
    });
    const res = await client().post('/api/visitors/lookup').send({ email: 'bob@X.COM' });
    expect(res.status).toBe(200);
    expect(res.body.visitor.name).toBe('Bob');
  });
});

describe('Visit creation uses 1-year NDA cache', () => {
  beforeEach(resetDb);

  test('returning visitor with fresh ack: NDA not required this visit', async () => {
    saveDocument({ kind: 'nda', title: 'NDA', body: 'V1' });
    const host = createUser({ username: 'h', role: 'admin' });

    // First visit: full ack with signature.
    await client().post('/api/visits').send({
      visitorName: 'Alice', email: 'a@x.com', hostUserId: host.id,
      acknowledgments: [{ kind: 'nda', signedName: 'Alice', signaturePngBase64: TINY_PNG }],
    });

    // Return visit: no acknowledgments needed.
    const res = await client().post('/api/visits').send({
      visitorName: 'Alice', email: 'a@x.com', hostUserId: host.id,
      // No acknowledgments[]; should still succeed because of cache hit.
    });
    expect(res.status).toBe(201);

    // Audit row records it as cached.
    const audit = row('SELECT details FROM audit_log WHERE subject_id = ?', res.body.visit.id);
    const details = JSON.parse(audit.details);
    expect(details.ndaCacheHit).toBeTruthy();
    expect(details.acknowledgments.find(a => a.kind === 'nda').cached).toBe(true);
  });

  test('returning visitor with NDA version bump: must re-sign', async () => {
    saveDocument({ kind: 'nda', title: 'NDA', body: 'V1' });
    const host = createUser({ username: 'h', role: 'admin' });

    await client().post('/api/visits').send({
      visitorName: 'Alice', email: 'a@x.com', hostUserId: host.id,
      acknowledgments: [{ kind: 'nda', signedName: 'Alice', signaturePngBase64: TINY_PNG }],
    });

    saveDocument({ kind: 'nda', title: 'NDA', body: 'V2' }); // version bump

    const res = await client().post('/api/visits').send({
      visitorName: 'Alice', email: 'a@x.com', hostUserId: host.id,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/acknowledgment required/);
  });

  test('returning visitor reuses visitor_id', async () => {
    const host = createUser({ username: 'h', role: 'admin' });
    const v1 = await client().post('/api/visits').send({
      visitorName: 'Alice', email: 'a@x.com', hostUserId: host.id,
    });
    const v2 = await client().post('/api/visits').send({
      visitorName: 'Alice S.', email: 'a@x.com', hostUserId: host.id,
    });
    expect(v1.body.visit.visitor.id).toBe(v2.body.visit.visitor.id);
  });

  test('emailless visit gets visitor_id = null', async () => {
    const host = createUser({ username: 'h', role: 'admin' });
    const res = await client().post('/api/visits').send({
      visitorName: 'Anonymous', hostUserId: host.id,
    });
    expect(res.status).toBe(201);
    expect(res.body.visit.visitor).toBeNull();
  });
});
