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

describe('GET /api/visits/:id/photo (public)', () => {
  beforeEach(resetDb);

  test('returns the PNG when present', async () => {
    setSetting('photo.enabled', true);
    const host = createUser({ username: 'h', role: 'admin' });
    const c = await client().post('/api/visits').send({
      visitorName: 'A', hostUserId: host.id, photoPngBase64: TINY_PNG,
    });
    const res = await client().get(`/api/visits/${c.body.visit.id}/photo`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/png/);
  });

  test('404 when no photo on visit', async () => {
    const host = createUser({ username: 'h', role: 'admin' });
    const c = await client().post('/api/visits').send({ visitorName: 'A', hostUserId: host.id });
    const res = await client().get(`/api/visits/${c.body.visit.id}/photo`);
    expect(res.status).toBe(404);
  });

  test('404 on unknown visit', async () => {
    const res = await client().get('/api/visits/99999/photo');
    expect(res.status).toBe(404);
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
