import { config } from '../config.js';
import { logger } from '../logger.js';
import { createPending, markSent, markFailed } from '../services/notificationsLog.js';

let testSender = null;

export function smsEnabled() {
  return Boolean(config.notifications?.sms?.enabled);
}

/**
 * Send an SMS. Every attempt writes a row to notifications_log:
 *   - 'pending' before the transport call
 *   - 'sent' on success, 'failed' (with error message) on throw
 */
export async function sendSms({ to, body, event = 'unspecified' }) {
  if (!smsEnabled() && !testSender) return;
  if (!to || (Array.isArray(to) && to.length === 0)) return;
  const recipients = Array.isArray(to) ? to : [to];

  for (const recipient of recipients) {
    const logId = createPending({ kind: 'sms', event, recipient, subject: null });
    try {
      if (testSender) {
        await testSender({ to: recipient, body });
      } else {
        const adapter = config.notifications.sms.adapter ?? 'twilio';
        if (adapter === 'twilio') await sendViaTwilio(recipient, body);
        else if (adapter === 'log') logger.info({ to: recipient, body }, 'sms (log adapter)');
        else { logger.warn({ adapter }, 'unknown SMS adapter, skipping'); markSent(logId); continue; }
      }
      markSent(logId);
    } catch (err) {
      markFailed(logId, err);
      logger.error({ err: err.message, to: recipient }, 'sms send failed');
      // Don't throw — keep dispatching to remaining recipients. Failure is
      // visible in notifications_log; caller doesn't need to handle it.
    }
  }
}

async function sendViaTwilio(to, body) {
  const cfg = config.notifications.sms.twilio ?? {};
  const sid = cfg.accountSid;
  const token = config.smsAuthToken;
  if (!sid || !token) {
    throw new Error('Twilio SMS configured but credentials missing');
  }

  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const params = new URLSearchParams({ From: cfg.fromNumber, To: to, Body: body });
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`twilio ${res.status}: ${txt.slice(0, 200)}`);
  }
}

/** Test seam: pass a function `({to, body}) => Promise<void>` that intercepts sends. */
export function setSenderForTests(s) {
  testSender = s;
}
