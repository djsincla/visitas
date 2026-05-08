import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { resetDb, createUser, adminAgent, agentFor, rows } from './helpers.js';
import { config } from '../src/config.js';
import { setTransportForTests, sendEmail } from '../src/notifications/email.js';
import { setSenderForTests, sendSms } from '../src/notifications/sms.js';

const ORIGINAL = JSON.parse(JSON.stringify(config.notifications));

function configureNotifications() {
  config.notifications = {
    email: {
      enabled: true,
      from: 'visitas.world <test@visitas.world>',
      smtp: { host: 'smtp.test', port: 587, secure: false, user: 'test' },
      events: [],
    },
    sms: {
      enabled: true,
      adapter: 'twilio',
      twilio: { accountSid: 'AC_TEST', fromNumber: '+15555550100' },
      events: [],
    },
  };
}

beforeEach(() => {
  resetDb();
  configureNotifications();
});

afterEach(() => {
  setTransportForTests(null);
  setSenderForTests(null);
  config.notifications = JSON.parse(JSON.stringify(ORIGINAL));
});

describe('notifications_log — email', () => {
  test('creates a pending row, marks sent on success', async () => {
    setTransportForTests({ sendMail: async () => ({ messageId: 'ok-1' }) });
    await sendEmail({ to: 'a@example.com', subject: 'hi', text: 'body', event: 'signed_in' });

    const r = rows('SELECT * FROM notifications_log');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: 'email', event: 'signed_in', recipient: 'a@example.com', subject: 'hi', status: 'sent' });
    expect(r[0].sent_at).toBeTruthy();
    expect(r[0].error).toBeNull();
  });

  test('marks failed with error message when transport throws', async () => {
    setTransportForTests({ sendMail: async () => { throw new Error('smtp 535 auth failed'); } });
    await expect(sendEmail({ to: 'b@example.com', subject: 's', text: 't', event: 'signed_in' })).rejects.toThrow();

    const r = rows('SELECT * FROM notifications_log');
    expect(r).toHaveLength(1);
    expect(r[0].status).toBe('failed');
    expect(r[0].error).toContain('smtp 535');
  });
});

describe('notifications_log — sms', () => {
  test('records one row per recipient and per attempt; failures do not stop the loop', async () => {
    let calls = 0;
    setSenderForTests(async ({ to }) => {
      calls++;
      if (to === '+15555550111') throw new Error('twilio 21610 unsubscribed');
    });
    await sendSms({ to: ['+15555550110', '+15555550111', '+15555550112'], body: 'x', event: 'signed_in' });

    expect(calls).toBe(3);
    const r = rows('SELECT recipient, status, error FROM notifications_log ORDER BY id');
    expect(r).toHaveLength(3);
    expect(r[0]).toMatchObject({ recipient: '+15555550110', status: 'sent' });
    expect(r[1]).toMatchObject({ recipient: '+15555550111', status: 'failed' });
    expect(r[1].error).toContain('21610');
    expect(r[2]).toMatchObject({ recipient: '+15555550112', status: 'sent' });
  });
});

describe('GET /api/notifications-log', () => {
  test('admin can list; entries are most-recent first', async () => {
    setTransportForTests({ sendMail: async () => ({ messageId: 'ok' }) });
    await sendEmail({ to: 'first@example.com', subject: 'one', text: 'x', event: 'signed_in' });
    await sendEmail({ to: 'second@example.com', subject: 'two', text: 'x', event: 'signed_out' });

    const a = await adminAgent();
    const res = await a.get('/api/notifications-log');
    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(2);
    expect(res.body.entries[0].recipient).toBe('second@example.com');
    expect(res.body.entries[1].recipient).toBe('first@example.com');
  });

  test('status filter returns only matching rows', async () => {
    setTransportForTests({ sendMail: async ({ to }) => {
      if (to === 'fail@example.com') throw new Error('smtp boom');
      return { messageId: 'ok' };
    } });
    await sendEmail({ to: 'ok@example.com', subject: 'x', text: 'x', event: 'signed_in' });
    await sendEmail({ to: 'fail@example.com', subject: 'x', text: 'x', event: 'signed_in' }).catch(() => {});

    const a = await adminAgent();
    const res = await a.get('/api/notifications-log?status=failed');
    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.entries[0].recipient).toBe('fail@example.com');
  });

  test('security role is refused (admin-only surface)', async () => {
    await adminAgent();
    createUser({ username: 'sec', password: 'AAaa1234567', role: 'security' });
    const sec = await agentFor('sec', 'AAaa1234567');
    const res = await sec.get('/api/notifications-log');
    expect(res.status).toBe(403);
  });
});
