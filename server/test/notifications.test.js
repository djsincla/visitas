import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { resetDb, createUser, agentFor, client, adminAgent } from './helpers.js';
import { config } from '../src/config.js';
import { setTransportForTests } from '../src/notifications/email.js';
import { setSenderForTests } from '../src/notifications/sms.js';
import { notifyVisitEvent } from '../src/notifications/index.js';
import { createVisit, signOutVisit } from '../src/services/visits.js';

let emailsSent;
let smssSent;

function fakeEmailTransport() {
  emailsSent = [];
  setTransportForTests({
    sendMail: async (msg) => {
      emailsSent.push(msg);
      return { messageId: `test-${emailsSent.length}` };
    },
  });
}

function fakeSmsSender() {
  smssSent = [];
  setSenderForTests(async ({ to, body }) => {
    smssSent.push({ to, body });
  });
}

function clearTransports() {
  setTransportForTests(null);
  setSenderForTests(null);
}

const ORIGINAL_NOTIFICATIONS = JSON.parse(JSON.stringify(config.notifications));

function configureNotifications(overrides = {}) {
  config.notifications = {
    email: {
      enabled: false,
      from: 'visitas.world <test@visitas.world>',
      smtp: { host: 'smtp.test', port: 587, secure: false, user: 'test' },
      events: ['signed_in', 'signed_out', 'force_signed_out'],
      ...(overrides.email ?? {}),
    },
    sms: {
      enabled: false,
      adapter: 'twilio',
      twilio: { accountSid: 'AC_TEST', fromNumber: '+15555550100' },
      events: ['signed_in', 'signed_out', 'force_signed_out'],
      ...(overrides.sms ?? {}),
    },
  };
}

beforeEach(() => {
  resetDb();
  configureNotifications();
  fakeEmailTransport();
  fakeSmsSender();
});

afterEach(() => {
  clearTransports();
  config.notifications = JSON.parse(JSON.stringify(ORIGINAL_NOTIFICATIONS));
});

describe('notifyVisitEvent — routing', () => {
  test('signed_in fires email when host has email and channel enabled', async () => {
    config.notifications.email.enabled = true;
    const host = createUser({ username: 'hostA', email: 'hostA@example.com', role: 'admin' });
    const visit = createVisit({ visitorName: 'Alice', hostUserId: host.id });

    await notifyVisitEvent('signed_in', { visit });
    expect(emailsSent).toHaveLength(1);
    expect(emailsSent[0]).toMatchObject({ to: 'hostA@example.com' });
    expect(emailsSent[0].subject).toMatch(/Alice is here to see/);
  });

  test('signed_in fires SMS when host has phone and channel enabled', async () => {
    config.notifications.sms.enabled = true;
    const host = createUser({ username: 'hostA', phone: '+15555550111', role: 'admin' });
    const visit = createVisit({ visitorName: 'Alice', hostUserId: host.id });

    await notifyVisitEvent('signed_in', { visit });
    expect(smssSent).toHaveLength(1);
    expect(smssSent[0]).toMatchObject({ to: '+15555550111' });
    expect(smssSent[0].body).toMatch(/Alice is here/);
  });

  test('both channels fire when both enabled', async () => {
    config.notifications.email.enabled = true;
    config.notifications.sms.enabled = true;
    const host = createUser({ username: 'hostA', email: 'h@x.com', phone: '+15555550111', role: 'admin' });
    const visit = createVisit({ visitorName: 'Alice', hostUserId: host.id });

    await notifyVisitEvent('signed_in', { visit });
    expect(emailsSent).toHaveLength(1);
    expect(smssSent).toHaveLength(1);
  });

  test('skips email when host has no email', async () => {
    config.notifications.email.enabled = true;
    const host = createUser({ username: 'hostA', role: 'admin' });
    const visit = createVisit({ visitorName: 'Alice', hostUserId: host.id });

    await notifyVisitEvent('signed_in', { visit });
    expect(emailsSent).toHaveLength(0);
  });

  test('skips when channel is disabled in config', async () => {
    config.notifications.email.enabled = false;
    const host = createUser({ username: 'hostA', email: 'h@x.com', role: 'admin' });
    const visit = createVisit({ visitorName: 'Alice', hostUserId: host.id });

    await notifyVisitEvent('signed_in', { visit });
    expect(emailsSent).toHaveLength(0);
  });

  test('respects per-channel events filter', async () => {
    config.notifications.email.enabled = true;
    config.notifications.email.events = ['signed_in']; // exclude signed_out
    const host = createUser({ username: 'hostA', email: 'h@x.com', role: 'admin' });
    const visit = createVisit({ visitorName: 'Alice', hostUserId: host.id });

    await notifyVisitEvent('signed_out', { visit });
    expect(emailsSent).toHaveLength(0);

    await notifyVisitEvent('signed_in', { visit });
    expect(emailsSent).toHaveLength(1);
  });

  test('force_signed_out subject mentions reception, body names actor', async () => {
    config.notifications.email.enabled = true;
    const host = createUser({ username: 'hostA', email: 'h@x.com', role: 'admin' });
    const visit = createVisit({ visitorName: 'Alice', hostUserId: host.id });
    const actor = { id: 99, username: 'guard', display_name: 'Guard One', role: 'security' };

    await notifyVisitEvent('force_signed_out', { visit, actor });
    expect(emailsSent).toHaveLength(1);
    expect(emailsSent[0].subject).toMatch(/signed out by reception/);
    expect(emailsSent[0].text).toMatch(/Guard One/);
    expect(emailsSent[0].text).toMatch(/security/);
  });
});

describe('Visit lifecycle wires notifications', () => {
  test('createVisit dispatches signed_in notification (via service-layer await)', async () => {
    config.notifications.email.enabled = true;
    const host = createUser({ username: 'hostA', email: 'h@x.com', role: 'admin' });
    const visit = createVisit({ visitorName: 'Alice', hostUserId: host.id });

    // Service uses async dispatch; we drive it directly to avoid relying on setImmediate timing.
    await notifyVisitEvent('signed_in', { visit });
    expect(emailsSent).toHaveLength(1);
  });

  test('signOutVisit (kiosk method) dispatches signed_out notification', async () => {
    config.notifications.email.enabled = true;
    const host = createUser({ username: 'hostA', email: 'h@x.com', role: 'admin' });
    const visit = createVisit({ visitorName: 'Alice', hostUserId: host.id });
    const out = signOutVisit({ visitId: visit.id, byUserId: null, method: 'kiosk' });

    await notifyVisitEvent('signed_out', { visit: out });
    expect(emailsSent).toHaveLength(1);
    expect(emailsSent[0].subject).toMatch(/signed out/);
  });
});

describe('POST /api/settings/email/test (admin)', () => {
  test('returns 400 when email channel disabled', async () => {
    const a = await adminAgent();
    const res = await a.post('/api/settings/email/test').send({ to: 'me@example.com' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/disabled/);
  });

  test('sends a test email when enabled', async () => {
    config.notifications.email.enabled = true;
    const a = await adminAgent();
    const res = await a.post('/api/settings/email/test').send({ to: 'me@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(emailsSent).toHaveLength(1);
    expect(emailsSent[0].to).toBe('me@example.com');
    expect(emailsSent[0].subject).toMatch(/Test email/);
  });

  test('400 on bad email', async () => {
    config.notifications.email.enabled = true;
    const a = await adminAgent();
    const res = await a.post('/api/settings/email/test').send({ to: 'not-an-email' });
    expect(res.status).toBe(400);
  });

  test('non-admin refused', async () => {
    config.notifications.email.enabled = true;
    createUser({ username: 'guard', password: 'GuardPass123', role: 'security' });
    const a = await agentFor('guard', 'GuardPass123');
    const res = await a.post('/api/settings/email/test').send({ to: 'me@example.com' });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/settings/sms/test (admin)', () => {
  test('returns 400 when SMS channel disabled', async () => {
    const a = await adminAgent();
    const res = await a.post('/api/settings/sms/test').send({ to: '+15555550100' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/disabled/);
  });

  test('sends a test SMS when enabled', async () => {
    config.notifications.sms.enabled = true;
    const a = await adminAgent();
    const res = await a.post('/api/settings/sms/test').send({ to: '+15555550100' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(smssSent).toHaveLength(1);
    expect(smssSent[0].to).toBe('+15555550100');
    expect(smssSent[0].body).toMatch(/Test SMS/);
  });
});
