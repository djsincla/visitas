import { config } from '../config.js';
import { logger } from '../logger.js';

let testSender = null;

export function smsEnabled() {
  return Boolean(config.notifications?.sms?.enabled);
}

export async function sendSms({ to, body }) {
  if (!smsEnabled() && !testSender) return;
  if (!to || (Array.isArray(to) && to.length === 0)) return;
  const recipients = Array.isArray(to) ? to : [to];

  if (testSender) {
    for (const t of recipients) await testSender({ to: t, body });
    return;
  }

  const adapter = config.notifications.sms.adapter ?? 'twilio';
  switch (adapter) {
    case 'twilio': return sendViaTwilio(recipients, body);
    case 'log':    logger.info({ to: recipients, body }, 'sms (log adapter)'); return;
    default:       logger.warn({ adapter }, 'unknown SMS adapter, skipping');
  }
}

async function sendViaTwilio(recipients, body) {
  const cfg = config.notifications.sms.twilio ?? {};
  const sid = cfg.accountSid;
  const token = config.smsAuthToken;
  if (!sid || !token) {
    logger.warn('Twilio SMS configured but credentials missing; skipping');
    return;
  }

  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;

  for (const to of recipients) {
    const params = new URLSearchParams({ From: cfg.fromNumber, To: to, Body: body });
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });
    if (!res.ok) {
      const txt = await res.text();
      logger.error({ status: res.status, body: txt, to }, 'twilio send failed');
    } else {
      logger.info({ to }, 'sms sent');
    }
  }
}

/** Test seam: pass a function `({to, body}) => Promise<void>` that intercepts sends. */
export function setSenderForTests(s) {
  testSender = s;
}
