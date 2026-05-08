import { describe, test, expect, beforeEach } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { resetDb, createUser, client, adminAgent, row } from './helpers.js';
import { setSetting } from '../src/services/settings.js';
import { purgeExpiredPhotos } from '../src/services/photo.js';
import { db } from '../src/db/index.js';

const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

const photoDir = () => resolve(process.env.DATA_DIR, 'photos');

describe('Photo capture (opt-in via settings.photo.enabled)', () => {
  beforeEach(resetDb);

  test('photo ignored when photo.enabled is false (default)', async () => {
    const host = createUser({ username: 'h', role: 'admin' });
    const res = await client().post('/api/visits').send({
      visitorName: 'A', hostUserId: host.id, photoPngBase64: TINY_PNG,
    });
    expect(res.status).toBe(201);
    expect(res.body.visit.photoPath).toBeNull();
    // No photo file written.
    if (existsSync(photoDir())) {
      expect(readdirSync(photoDir())).toHaveLength(0);
    }
  });

  test('photo stored when enabled', async () => {
    setSetting('photo.enabled', true);
    const host = createUser({ username: 'h', role: 'admin' });
    const res = await client().post('/api/visits').send({
      visitorName: 'A', hostUserId: host.id, photoPngBase64: TINY_PNG,
    });
    expect(res.status).toBe(201);
    expect(res.body.visit.photoPath).toMatch(/photos\/visit-\d+\.png/);
    expect(existsSync(resolve(process.env.DATA_DIR, res.body.visit.photoPath))).toBe(true);
  });
});

describe('GET /api/visits/photo/:token (public)', () => {
  beforeEach(resetDb);

  test('returns the PNG when present', async () => {
    setSetting('photo.enabled', true);
    const host = createUser({ username: 'h', role: 'admin' });
    const c = await client().post('/api/visits').send({
      visitorName: 'A', hostUserId: host.id, photoPngBase64: TINY_PNG,
    });
    const token = c.body.visit.publicToken;
    const res = await client().get(`/api/visits/photo/${token}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/png/);
  });

  test('404 when no photo on visit', async () => {
    const host = createUser({ username: 'h', role: 'admin' });
    const c = await client().post('/api/visits').send({ visitorName: 'A', hostUserId: host.id });
    const res = await client().get(`/api/visits/photo/${c.body.visit.publicToken}`);
    expect(res.status).toBe(404);
  });

  test('404 on unknown token', async () => {
    const res = await client().get('/api/visits/photo/' + 'a'.repeat(64));
    expect(res.status).toBe(404);
  });

  test('rejects non-PNG bytes (magic-byte check)', async () => {
    setSetting('photo.enabled', true);
    const host = createUser({ username: 'h', role: 'admin' });
    // Junk base64 — decodes to ascii, no PNG signature.
    const junk = Buffer.from('not a png at all, just text bytes here').toString('base64');
    const res = await client().post('/api/visits').send({
      visitorName: 'A', hostUserId: host.id, photoPngBase64: junk,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid photo PNG/);
  });
});

describe('Retention sweep (30-day purge)', () => {
  beforeEach(resetDb);

  test('purges visits older than 30 days', async () => {
    setSetting('photo.enabled', true);
    const host = createUser({ username: 'h', role: 'admin' });
    const c = await client().post('/api/visits').send({
      visitorName: 'A', hostUserId: host.id, photoPngBase64: TINY_PNG,
    });
    const id = c.body.visit.id;
    const photoFileBefore = resolve(process.env.DATA_DIR, c.body.visit.photoPath);
    expect(existsSync(photoFileBefore)).toBe(true);

    db.prepare("UPDATE visits SET signed_in_at = datetime('now', '-31 days') WHERE id = ?").run(id);

    const purged = purgeExpiredPhotos();
    expect(purged).toBe(1);
    expect(existsSync(photoFileBefore)).toBe(false);
    const after = row('SELECT photo_path FROM visits WHERE id = ?', id);
    expect(after.photo_path).toBeNull();
  });

  test('keeps visits within retention window', async () => {
    setSetting('photo.enabled', true);
    const host = createUser({ username: 'h', role: 'admin' });
    const c = await client().post('/api/visits').send({
      visitorName: 'A', hostUserId: host.id, photoPngBase64: TINY_PNG,
    });
    db.prepare("UPDATE visits SET signed_in_at = datetime('now', '-29 days') WHERE id = ?").run(c.body.visit.id);

    const purged = purgeExpiredPhotos();
    expect(purged).toBe(0);
  });

  test('respects configured retention_days (7-day window purges a 10-day-old photo, 30-day default would not)', async () => {
    setSetting('photo.enabled', true);
    setSetting('photo.retention_days', 7);
    const host = createUser({ username: 'h', role: 'admin' });
    const c = await client().post('/api/visits').send({
      visitorName: 'A', hostUserId: host.id, photoPngBase64: TINY_PNG,
    });
    db.prepare("UPDATE visits SET signed_in_at = datetime('now', '-10 days') WHERE id = ?").run(c.body.visit.id);

    expect(purgeExpiredPhotos()).toBe(1);
  });
});

describe('Photo retention setting endpoint', () => {
  beforeEach(resetDb);

  test('admin can read + update; PUT validates range', async () => {
    const a = await adminAgent();
    const r1 = await a.get('/api/settings/photo/retention');
    expect(r1.body).toEqual({ retentionDays: 30 });

    const r2 = await a.put('/api/settings/photo/retention').send({ retentionDays: 14 });
    expect(r2.status).toBe(200);
    expect(r2.body).toEqual({ retentionDays: 14 });

    const r3 = await a.put('/api/settings/photo/retention').send({ retentionDays: 0 });
    expect(r3.status).toBe(400);
    const r4 = await a.put('/api/settings/photo/retention').send({ retentionDays: 9999 });
    expect(r4.status).toBe(400);
  });
});

describe('PUT /api/settings/photo (admin toggle)', () => {
  beforeEach(resetDb);

  test('admin toggles enabled', async () => {
    const a = await adminAgent();
    let res = await a.get('/api/settings/photo');
    expect(res.body.enabled).toBe(false);

    res = await a.put('/api/settings/photo').send({ enabled: true });
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);

    res = await a.get('/api/settings/photo');
    expect(res.body.enabled).toBe(true);
  });

  test('non-admin cannot toggle', async () => {
    const sec = createUser({ username: 'guard', password: 'GuardPass123', role: 'security' });
    const { default: request } = await import('supertest');
    // We need a security-authed agent; reuse the test helper.
    const { agentFor } = await import('./helpers.js');
    const a = await agentFor('guard', 'GuardPass123');
    const res = await a.put('/api/settings/photo').send({ enabled: true });
    expect(res.status).toBe(403);
  });
});
