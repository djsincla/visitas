import { describe, test, expect, beforeEach } from 'vitest';
import { resetDb, createUser, agentFor, client, adminAgent, row } from './helpers.js';

describe('GET /api/kiosks/:slug (public)', () => {
  beforeEach(resetDb);

  test('returns the default kiosk', async () => {
    const res = await client().get('/api/kiosks/default');
    expect(res.status).toBe(200);
    expect(res.body.kiosk).toMatchObject({ slug: 'default', name: 'Reception' });
    // Sanitized — no id/createdAt/updatedAt.
    expect(res.body.kiosk).not.toHaveProperty('id');
    expect(res.body.kiosk).not.toHaveProperty('createdAt');
  });

  test('404 on unknown slug', async () => {
    const res = await client().get('/api/kiosks/loading-dock');
    expect(res.status).toBe(404);
  });
});

describe('Kiosk admin CRUD (admin only)', () => {
  beforeEach(resetDb);

  test('admin creates a kiosk with default printer name', async () => {
    const a = await adminAgent();
    const res = await a.post('/api/kiosks').send({
      slug: 'reception',
      name: 'Reception desk',
      defaultPrinterName: 'Brother QL-820NWB (Reception)',
    });
    expect(res.status).toBe(201);
    expect(res.body.kiosk).toMatchObject({
      slug: 'reception',
      name: 'Reception desk',
      defaultPrinterName: 'Brother QL-820NWB (Reception)',
      active: true,
    });
  });

  test('rejects bad slug format', async () => {
    const a = await adminAgent();
    const res = await a.post('/api/kiosks').send({ slug: 'Has Spaces!', name: 'X' });
    expect(res.status).toBe(400);
  });

  test('rejects duplicate slug', async () => {
    const a = await adminAgent();
    await a.post('/api/kiosks').send({ slug: 'reception', name: 'Reception' });
    const res = await a.post('/api/kiosks').send({ slug: 'reception', name: 'Other' });
    expect(res.status).toBe(409);
  });

  test('admin patches printer name', async () => {
    const a = await adminAgent();
    const res = await a.patch('/api/kiosks/default').send({ defaultPrinterName: 'New Printer' });
    expect(res.status).toBe(200);
    expect(res.body.kiosk.defaultPrinterName).toBe('New Printer');

    // Visible publicly (kiosk reads its own config).
    const pub = await client().get('/api/kiosks/default');
    expect(pub.body.kiosk.defaultPrinterName).toBe('New Printer');
  });

  test('admin lists all kiosks', async () => {
    const a = await adminAgent();
    await a.post('/api/kiosks').send({ slug: 'dock', name: 'Loading dock' });
    const res = await a.get('/api/kiosks');
    expect(res.status).toBe(200);
    const slugs = res.body.kiosks.map(k => k.slug);
    expect(slugs).toContain('default');
    expect(slugs).toContain('dock');
  });

  test('refuses to deactivate the default kiosk', async () => {
    const a = await adminAgent();
    const res = await a.delete('/api/kiosks/default');
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/default kiosk/);
  });

  test('admin can deactivate non-default kiosk', async () => {
    const a = await adminAgent();
    await a.post('/api/kiosks').send({ slug: 'dock', name: 'Loading dock' });
    const res = await a.delete('/api/kiosks/dock');
    expect(res.status).toBe(200);
    expect(res.body.kiosk.active).toBe(false);

    // Public kiosk lookup now 404s for the deactivated one.
    const pub = await client().get('/api/kiosks/dock');
    expect(pub.status).toBe(404);
  });

  test('non-admin (security) cannot manage kiosks', async () => {
    createUser({ username: 'guard', password: 'GuardPass123', role: 'security' });
    const a = await agentFor('guard', 'GuardPass123');
    const res = await a.post('/api/kiosks').send({ slug: 'dock', name: 'Dock' });
    expect(res.status).toBe(403);
  });

  test('unauthed cannot manage kiosks', async () => {
    const res = await client().post('/api/kiosks').send({ slug: 'dock', name: 'Dock' });
    expect(res.status).toBe(401);
  });
});

describe('Visit creation with kiosk slug', () => {
  beforeEach(resetDb);

  test('attaches kiosk_id from kioskSlug', async () => {
    const host = createUser({ username: 'h', email: 'h@x.com', role: 'admin' });
    const a = await adminAgent();
    await a.post('/api/kiosks').send({ slug: 'dock', name: 'Loading dock' });

    const res = await client().post('/api/visits').send({
      visitorName: 'Walk-In', hostUserId: host.id, kioskSlug: 'dock',
    });
    expect(res.status).toBe(201);
    expect(res.body.visit.kiosk).toMatchObject({ slug: 'dock', name: 'Loading dock' });
  });

  test('falls back to default kiosk when slug omitted', async () => {
    const host = createUser({ username: 'h', email: 'h@x.com', role: 'admin' });
    const res = await client().post('/api/visits').send({
      visitorName: 'Walk-In', hostUserId: host.id,
    });
    expect(res.status).toBe(201);
    expect(res.body.visit.kiosk?.slug).toBe('default');
  });

  test('refuses unknown kiosk slug', async () => {
    const host = createUser({ username: 'h', email: 'h@x.com', role: 'admin' });
    const res = await client().post('/api/visits').send({
      visitorName: 'X', hostUserId: host.id, kioskSlug: 'nope',
    });
    expect(res.status).toBe(400);
  });
});

describe('Wall view filters by kiosk', () => {
  beforeEach(resetDb);

  test('?kiosk=slug filters to that kiosk only', async () => {
    const host = createUser({ username: 'h', role: 'admin' });
    const a = await adminAgent();
    await a.post('/api/kiosks').send({ slug: 'dock', name: 'Dock' });

    await client().post('/api/visits').send({ visitorName: 'A', hostUserId: host.id, kioskSlug: 'default' });
    await client().post('/api/visits').send({ visitorName: 'B', hostUserId: host.id, kioskSlug: 'dock' });

    const all = await client().get('/api/visits/active');
    expect(all.body.visits).toHaveLength(2);

    const dock = await client().get('/api/visits/active?kiosk=dock');
    expect(dock.body.visits).toHaveLength(1);
    expect(dock.body.visits[0].visitorName).toBe('B');
    expect(dock.body.visits[0].kioskSlug).toBe('dock');
  });
});

describe('GET /api/visits/:id/badge (public)', () => {
  beforeEach(resetDb);

  test('returns printable HTML with visitor + host + kiosk + printer hint', async () => {
    const host = createUser({ username: 'jane', displayName: 'Jane Host', role: 'admin' });
    const a = await adminAgent();
    await a.patch('/api/kiosks/default').send({ defaultPrinterName: 'Reception Printer' });
    const create = await client().post('/api/visits').send({
      visitorName: 'Bob Visitor', company: 'ACME', hostUserId: host.id,
    });
    const id = create.body.visit.id;

    const res = await client().get(`/api/visits/${id}/badge`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('Bob Visitor');
    expect(res.text).toContain('ACME');
    expect(res.text).toContain('Jane Host');
    expect(res.text).toContain('Reception Printer');
  });

  test('escapes HTML in visitor name (no XSS via name)', async () => {
    const host = createUser({ username: 'h', role: 'admin' });
    const create = await client().post('/api/visits').send({
      visitorName: '<script>alert(1)</script>', hostUserId: host.id,
    });
    const res = await client().get(`/api/visits/${create.body.visit.id}/badge`);
    expect(res.text).not.toContain('<script>alert(1)</script>');
    expect(res.text).toContain('&lt;script&gt;');
  });

  test('404 on unknown visit', async () => {
    const res = await client().get('/api/visits/9999/badge');
    expect(res.status).toBe(404);
  });
});
