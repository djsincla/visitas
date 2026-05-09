import { describe, test, expect, beforeEach } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { resetDb, createUser, adminAgent, agentFor, client, row, rows } from './helpers.js';
import { setSetting } from '../src/services/settings.js';
import { saveDocument } from '../src/services/documents.js';
import { purgeVisitor } from '../src/services/visitorPurge.js';
import { createBan } from '../src/services/bans.js';
import { db } from '../src/db/index.js';

const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

async function seedAlice({ withPhoto = false, withNda = false } = {}) {
  const host = createUser({ username: 'host1', displayName: 'Mary Host', role: 'admin' });
  if (withNda) saveDocument({ kind: 'nda', title: 'NDA', body: 'sign here', createdByUserId: host.id });
  if (withPhoto) setSetting('photo.enabled', true);
  const payload = {
    visitorName: 'Alice Smith', email: 'alice@example.com', company: 'ACME',
    phone: '+15555550100', purpose: 'Project sync', hostUserId: host.id,
  };
  if (withPhoto) payload.photoPngBase64 = TINY_PNG;
  if (withNda) {
    payload.acknowledgments = [{ kind: 'nda', signedName: 'Alice Smith', signaturePngBase64: TINY_PNG }];
  }
  const res = await client().post('/api/visits').send(payload);
  expect(res.status).toBe(201);
  return { hostId: host.id, visit: res.body.visit };
}

describe('purgeVisitor — service', () => {
  beforeEach(resetDb);

  test('returns null when visitor does not exist', () => {
    expect(purgeVisitor({ visitorId: 999 })).toBeNull();
  });

  test('scrubs visit PII but keeps the visit row + status timestamps', async () => {
    const { visit } = await seedAlice();
    const visitor = row('SELECT * FROM visitors WHERE LOWER(email) = ?', 'alice@example.com');

    const out = purgeVisitor({ visitorId: visitor.id });
    expect(out.visitsScrubbed).toBe(1);

    const after = row('SELECT * FROM visits WHERE id = ?', visit.id);
    expect(after.visitor_name).toBe('[purged]');
    expect(after.email).toBeNull();
    expect(after.phone).toBeNull();
    expect(after.company).toBeNull();
    expect(after.visitor_id).toBeNull();
    // Audit shape preserved.
    expect(after.signed_in_at).toBeTruthy();
    expect(after.host_user_id).toBeTruthy();
    expect(after.status).toBe('on_site');
  });

  test('deletes visitors row outright', async () => {
    await seedAlice();
    const visitor = row('SELECT * FROM visitors WHERE LOWER(email) = ?', 'alice@example.com');

    purgeVisitor({ visitorId: visitor.id });

    expect(row('SELECT 1 FROM visitors WHERE id = ?', visitor.id)).toBeUndefined();
  });

  test('deletes photo file from disk and nulls photo_path', async () => {
    const { visit } = await seedAlice({ withPhoto: true });
    const photoAbs = resolve(process.env.DATA_DIR, visit.photoPath);
    expect(existsSync(photoAbs)).toBe(true);

    const visitor = row('SELECT * FROM visitors WHERE LOWER(email) = ?', 'alice@example.com');
    const out = purgeVisitor({ visitorId: visitor.id });

    expect(out.photosDeleted).toBe(1);
    expect(existsSync(photoAbs)).toBe(false);
    expect(row('SELECT photo_path FROM visits WHERE id = ?', visit.id).photo_path).toBeNull();
  });

  test('deletes signature files and nulls signed_name + signature_path', async () => {
    const { visit } = await seedAlice({ withNda: true });
    const sig = row('SELECT signature_path, signed_name FROM visit_acknowledgments WHERE visit_id = ?', visit.id);
    expect(sig.signature_path).toBeTruthy();
    expect(sig.signed_name).toBe('Alice Smith');
    const sigAbs = resolve(process.env.DATA_DIR, sig.signature_path);
    expect(existsSync(sigAbs)).toBe(true);

    const visitor = row('SELECT * FROM visitors WHERE LOWER(email) = ?', 'alice@example.com');
    const out = purgeVisitor({ visitorId: visitor.id });

    expect(out.signaturesDeleted).toBe(1);
    expect(out.acksScrubbed).toBeGreaterThanOrEqual(1);
    expect(existsSync(sigAbs)).toBe(false);
    const after = row('SELECT signed_name, signature_path FROM visit_acknowledgments WHERE visit_id = ?', visit.id);
    expect(after.signed_name).toBeNull();
    expect(after.signature_path).toBeNull();
  });

  test('also catches visits with same email but visitor_id NULL (legacy / pre-v0.6)', async () => {
    const { hostId } = await seedAlice();
    // Manually un-link an existing visit to simulate an old row.
    const visit = row("SELECT id FROM visits WHERE LOWER(email) = ?", 'alice@example.com');
    db.prepare("UPDATE visits SET visitor_id = NULL WHERE id = ?").run(visit.id);

    const visitor = row('SELECT * FROM visitors WHERE LOWER(email) = ?', 'alice@example.com');
    const out = purgeVisitor({ visitorId: visitor.id });
    expect(out.visitsScrubbed).toBe(1);
    expect(row('SELECT email FROM visits WHERE id = ?', visit.id).email).toBeNull();
  });

  test('scrubs prereg_invitations matching the visitor email', async () => {
    const a = await adminAgent();
    const host = createUser({ username: 'host1', displayName: 'Mary', role: 'admin' });
    const inv = await a.post('/api/invitations').send({
      visitorName: 'Alice', email: 'alice@example.com', hostUserId: host.id,
    });
    expect(inv.status).toBe(201);

    // Need a visitor row to call purge against.
    db.prepare("INSERT INTO visitors (name, email) VALUES ('Alice', 'alice@example.com')").run();
    const visitor = row('SELECT * FROM visitors WHERE LOWER(email) = ?', 'alice@example.com');

    const out = purgeVisitor({ visitorId: visitor.id });
    expect(out.invitationsScrubbed).toBe(1);

    const after = row('SELECT * FROM prereg_invitations WHERE id = ?', inv.body.invitation.id);
    expect(after.email).toBe('[purged]');
    expect(after.visitor_name).toBe('[purged]');
    expect(after.token).toBeTruthy(); // structural fields preserved
    expect(after.status).toBeTruthy();
  });

  test('scrubs notifications_log entries to the visitor email', async () => {
    db.prepare(`
      INSERT INTO notifications_log (kind, event, recipient, subject, status)
      VALUES ('email', 'signed_in', 'alice@example.com', 'visit', 'sent')
    `).run();
    db.prepare(`
      INSERT INTO notifications_log (kind, event, recipient, subject, status)
      VALUES ('email', 'signed_in', 'someone-else@example.com', 'visit', 'sent')
    `).run();

    db.prepare("INSERT INTO visitors (name, email) VALUES ('Alice', 'alice@example.com')").run();
    const visitor = row('SELECT * FROM visitors WHERE LOWER(email) = ?', 'alice@example.com');

    purgeVisitor({ visitorId: visitor.id });

    const r = rows('SELECT recipient FROM notifications_log ORDER BY id');
    expect(r[0].recipient).toBe('[purged]');
    expect(r[1].recipient).toBe('someone-else@example.com'); // untouched
  });

  test('unlinks visitor-mode bans (visitor_id → NULL) but keeps the ban row', async () => {
    const admin = await adminAgent();
    const me = (await admin.get('/api/auth/me')).body.user;

    db.prepare("INSERT INTO visitors (name, email) VALUES ('Alice', 'alice@example.com')").run();
    const visitor = row('SELECT * FROM visitors WHERE LOWER(email) = ?', 'alice@example.com');

    const ban = createBan({
      mode: 'visitor', visitorId: visitor.id, reason: 'IP leak',
      createdByUserId: me.id,
    });

    purgeVisitor({ visitorId: visitor.id });

    const after = row('SELECT * FROM visitor_bans WHERE id = ?', ban.id);
    expect(after).toBeTruthy();
    expect(after.visitor_id).toBeNull();
    expect(after.reason).toBe('IP leak'); // ban itself preserved
    expect(after.active).toBe(1);
  });

  test('writes a visitor_purged audit row carrying the actor + counts', async () => {
    const admin = await adminAgent();
    const me = (await admin.get('/api/auth/me')).body.user;

    await seedAlice();
    const visitor = row('SELECT * FROM visitors WHERE LOWER(email) = ?', 'alice@example.com');

    purgeVisitor({ visitorId: visitor.id, actorUserId: me.id, reason: 'subject access request 42' });

    const audit = row(`
      SELECT * FROM audit_log
      WHERE action = 'visitor_purged' AND subject_id = ?
    `, visitor.id);
    expect(audit).toBeTruthy();
    expect(audit.user_id).toBe(me.id);
    const details = JSON.parse(audit.details);
    expect(details.reason).toBe('subject access request 42');
    expect(details.visitsScrubbed).toBeGreaterThanOrEqual(1);
  });

  test('nulls audit_log.details for visit-subject rows about the affected visits', async () => {
    const { visit } = await seedAlice();
    // The signed-in audit row already has details with hostUserId etc.
    const before = row(`SELECT details FROM audit_log WHERE subject_type = 'visit' AND subject_id = ?`, visit.id);
    expect(before.details).toContain('hostUserId');

    const visitor = row('SELECT * FROM visitors WHERE LOWER(email) = ?', 'alice@example.com');
    purgeVisitor({ visitorId: visitor.id });

    const after = row(`SELECT details, action FROM audit_log WHERE subject_type = 'visit' AND subject_id = ?`, visit.id);
    expect(after.details).toBeNull();
    expect(after.action).toBe('visit_signed_in'); // shape preserved
  });
});

describe('DELETE /api/visitors/:id', () => {
  beforeEach(resetDb);

  test('admin can purge a visitor (200 + counts)', async () => {
    await seedAlice();
    const a = await adminAgent();

    const visitor = row('SELECT id FROM visitors WHERE LOWER(email) = ?', 'alice@example.com');
    const res = await a.delete(`/api/visitors/${visitor.id}`).send({ reason: 'dsar #1' });
    expect(res.status).toBe(200);
    expect(res.body.visitsScrubbed).toBe(1);
  });

  test('returns 404 for unknown visitor', async () => {
    const a = await adminAgent();
    const res = await a.delete('/api/visitors/99999').send({});
    expect(res.status).toBe(404);
  });

  test('security role is refused', async () => {
    await adminAgent();
    createUser({ username: 'sec', password: 'AAaa1234567', role: 'security' });
    const sec = await agentFor('sec', 'AAaa1234567');

    const res = await sec.delete('/api/visitors/1').send({});
    expect(res.status).toBe(403);
  });

  test('unauthenticated client is refused', async () => {
    const res = await client().delete('/api/visitors/1').send({});
    expect(res.status).toBe(401);
  });
});
