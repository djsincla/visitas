import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { resetDb, createUser, agentFor, client, adminAgent, row, rows } from './helpers.js';
import { config } from '../src/config.js';
import { saveDocument, getActive } from '../src/services/documents.js';
import { setVisitorNdaSenderForTests } from '../src/notifications/visitorNda.js';

describe('Documents — service-level CRUD', () => {
  beforeEach(resetDb);

  test('first save creates v1', () => {
    const d = saveDocument({ kind: 'nda', title: 'NDA', body: 'You shall not blab.' });
    expect(d).toMatchObject({ kind: 'nda', version: 1, active: true });
  });

  test('second save bumps to v2 and deactivates v1', () => {
    saveDocument({ kind: 'nda', title: 'NDA', body: 'V1' });
    const v2 = saveDocument({ kind: 'nda', title: 'NDA v2', body: 'V2' });
    expect(v2.version).toBe(2);

    const all = rows('SELECT version, active FROM documents WHERE kind = ? ORDER BY version', 'nda');
    expect(all).toEqual([
      { version: 1, active: 0 },
      { version: 2, active: 1 },
    ]);
  });

  test('saving identical title+body does not bump', () => {
    const v1 = saveDocument({ kind: 'safety', title: 'Safety', body: 'Mind the ladder.' });
    const v2 = saveDocument({ kind: 'safety', title: 'Safety', body: 'Mind the ladder.' });
    expect(v2.id).toBe(v1.id);
    expect(v2.version).toBe(1);
  });
});

describe('GET /api/documents/active (public)', () => {
  beforeEach(resetDb);

  test('returns active docs for both kinds when present', async () => {
    saveDocument({ kind: 'nda', title: 'NDA', body: 'You shall not blab.' });
    saveDocument({ kind: 'safety', title: 'Safety', body: 'Wear shoes.' });
    const res = await client().get('/api/documents/active');
    expect(res.status).toBe(200);
    expect(res.body.documents).toHaveLength(2);
    const kinds = res.body.documents.map(d => d.kind).sort();
    expect(kinds).toEqual(['nda', 'safety']);
  });

  test('omits inactive docs', async () => {
    saveDocument({ kind: 'nda', title: 'NDA v1', body: 'V1' });
    saveDocument({ kind: 'nda', title: 'NDA v2', body: 'V2' });
    const res = await client().get('/api/documents/active');
    expect(res.body.documents).toHaveLength(1);
    expect(res.body.documents[0].version).toBe(2);
  });

  test('does not require auth', async () => {
    const res = await client().get('/api/documents/active');
    expect(res.status).toBe(200);
  });
});

describe('Documents admin endpoints', () => {
  beforeEach(resetDb);

  test('admin can save a new doc → version returned', async () => {
    const a = await adminAgent();
    const res = await a.post('/api/documents').send({
      kind: 'nda', title: 'Workshop NDA', body: 'Confidentiality applies.',
    });
    expect(res.status).toBe(201);
    expect(res.body.document.version).toBe(1);
  });

  test('admin can save a v2 → version bumps', async () => {
    const a = await adminAgent();
    await a.post('/api/documents').send({ kind: 'nda', title: 'NDA', body: 'V1' });
    const res = await a.post('/api/documents').send({ kind: 'nda', title: 'NDA v2', body: 'V2' });
    expect(res.body.document.version).toBe(2);
  });

  test('admin lists all versions', async () => {
    const a = await adminAgent();
    await a.post('/api/documents').send({ kind: 'nda', title: 'NDA', body: 'V1' });
    await a.post('/api/documents').send({ kind: 'nda', title: 'NDA', body: 'V2' });
    const res = await a.get('/api/documents?kind=nda');
    expect(res.body.documents).toHaveLength(2);
  });

  test('admin can deactivate', async () => {
    const a = await adminAgent();
    await a.post('/api/documents').send({ kind: 'safety', title: 'Safety', body: 'V1' });
    const res = await a.delete('/api/documents/safety');
    expect(res.status).toBe(200);
    expect(getActive('safety')).toBeNull();
  });

  test('non-admin (security) refused', async () => {
    createUser({ username: 'guard', password: 'GuardPass123', role: 'security' });
    const a = await agentFor('guard', 'GuardPass123');
    const res = await a.post('/api/documents').send({ kind: 'nda', title: 'X', body: 'Y' });
    expect(res.status).toBe(403);
  });

  test('rejects unknown kind', async () => {
    const a = await adminAgent();
    const res = await a.post('/api/documents').send({ kind: 'rules', title: 'X', body: 'Y' });
    expect(res.status).toBe(400);
  });
});

describe('Visit creation with acknowledgments', () => {
  let captured;
  const ORIGINAL_NOTIFICATIONS = JSON.parse(JSON.stringify(config.notifications));
  beforeEach(() => {
    resetDb();
    captured = [];
    setVisitorNdaSenderForTests(async (msg) => { captured.push(msg); });
    rmSync(resolve(config.dataDir, 'signatures'), { recursive: true, force: true });
    // Reset notifications config so per-test mutations don't bleed forward.
    config.notifications = JSON.parse(JSON.stringify(ORIGINAL_NOTIFICATIONS));
  });
  afterEach(() => setVisitorNdaSenderForTests(null));

  // 1×1 transparent PNG
  const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

  test('refuses sign-in when active NDA exists and ack missing', async () => {
    saveDocument({ kind: 'nda', title: 'NDA', body: 'No leaks.' });
    const host = createUser({ username: 'h', email: 'h@x.com', role: 'admin' });

    const res = await client().post('/api/visits').send({
      visitorName: 'Alice', hostUserId: host.id,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/acknowledgment required: nda/);
  });

  test('refuses NDA acknowledgment without signature', async () => {
    saveDocument({ kind: 'nda', title: 'NDA', body: 'No leaks.' });
    const host = createUser({ username: 'h', email: 'h@x.com', role: 'admin' });

    const res = await client().post('/api/visits').send({
      visitorName: 'Alice', hostUserId: host.id,
      acknowledgments: [{ kind: 'nda', signedName: 'Alice' }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/NDA signature required/);
  });

  test('signs in with NDA + safety acks → records rows + writes signature file', async () => {
    saveDocument({ kind: 'nda', title: 'NDA', body: 'No leaks.' });
    saveDocument({ kind: 'safety', title: 'Safety', body: 'Wear shoes.' });
    const host = createUser({ username: 'h', email: 'h@x.com', role: 'admin' });

    const res = await client().post('/api/visits').send({
      visitorName: 'Alice', hostUserId: host.id,
      acknowledgments: [
        { kind: 'safety', signedName: 'Alice' },
        { kind: 'nda', signedName: 'Alice', signaturePngBase64: TINY_PNG_B64 },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.visit.acknowledgments).toHaveLength(2);
    const ndaAck = res.body.visit.acknowledgments.find(a => a.kind === 'nda');
    expect(ndaAck.documentVersion).toBe(1);
    expect(ndaAck.signaturePath).toMatch(/signatures\/visit-\d+-nda\.png/);

    // The signature file lives on disk.
    const sigDir = resolve(config.dataDir, 'signatures');
    const files = readdirSync(sigDir);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/visit-\d+-nda\.png/);
  });

  test('emails signed NDA copy to visitor when email + email channel enabled', async () => {
    saveDocument({ kind: 'nda', title: 'NDA', body: 'No leaks.' });
    const host = createUser({ username: 'h', email: 'h@x.com', role: 'admin' });

    config.notifications = config.notifications ?? {};
    config.notifications.email = { enabled: true, from: 'visitas <a@b.c>', smtp: { host: 'smtp.t', user: 'u' } };

    const res = await client().post('/api/visits').send({
      visitorName: 'Alice',
      email: 'alice@example.com',
      hostUserId: host.id,
      acknowledgments: [
        { kind: 'nda', signedName: 'Alice', signaturePngBase64: TINY_PNG_B64 },
      ],
    });
    expect(res.status).toBe(201);

    // setImmediate hands the email off; pull it into this microtask.
    await new Promise(r => setImmediate(r));
    expect(captured).toHaveLength(1);
    expect(captured[0].to).toBe('alice@example.com');
    expect(captured[0].subject).toMatch(/Your signed NDA/);
    expect(captured[0].hasSig).toBe(true);
    expect(captured[0].html).toContain('No leaks.');
  });

  test('skips visitor email when no visitor email provided', async () => {
    saveDocument({ kind: 'nda', title: 'NDA', body: 'No leaks.' });
    const host = createUser({ username: 'h', email: 'h@x.com', role: 'admin' });
    config.notifications = config.notifications ?? {};
    config.notifications.email = { enabled: true, from: 'visitas <a@b.c>', smtp: { host: 'smtp.t', user: 'u' } };

    const res = await client().post('/api/visits').send({
      visitorName: 'Anonymous Visitor',
      hostUserId: host.id,
      acknowledgments: [
        { kind: 'nda', signedName: 'Anonymous Visitor', signaturePngBase64: TINY_PNG_B64 },
      ],
    });
    expect(res.status).toBe(201);

    await new Promise(r => setImmediate(r));
    expect(captured).toHaveLength(0);
  });

  test('skips visitor email when email channel is disabled', async () => {
    saveDocument({ kind: 'nda', title: 'NDA', body: 'No leaks.' });
    const host = createUser({ username: 'h', role: 'admin' });
    // Default config has email disabled.

    const res = await client().post('/api/visits').send({
      visitorName: 'Alice', email: 'alice@example.com', hostUserId: host.id,
      acknowledgments: [
        { kind: 'nda', signedName: 'Alice', signaturePngBase64: TINY_PNG_B64 },
      ],
    });
    expect(res.status).toBe(201);

    await new Promise(r => setImmediate(r));
    expect(captured).toHaveLength(0);
  });

  test('records audit details with acked versions', async () => {
    saveDocument({ kind: 'nda', title: 'NDA', body: 'V1' });
    saveDocument({ kind: 'safety', title: 'Safety', body: 'V1' });
    const host = createUser({ username: 'h', role: 'admin' });

    const create = await client().post('/api/visits').send({
      visitorName: 'Alice', hostUserId: host.id,
      acknowledgments: [
        { kind: 'safety', signedName: 'Alice' },
        { kind: 'nda', signedName: 'Alice', signaturePngBase64: TINY_PNG_B64 },
      ],
    });
    const audit = row('SELECT details FROM audit_log WHERE subject_type = ? AND subject_id = ?', 'visit', create.body.visit.id);
    const details = JSON.parse(audit.details);
    expect(details.acknowledgments).toEqual(expect.arrayContaining([
      { kind: 'nda', version: 1, cached: false },
      { kind: 'safety', version: 1, cached: false },
    ]));
  });
});
