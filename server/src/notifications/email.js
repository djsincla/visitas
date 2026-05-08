import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { createPending, markSent, markFailed } from '../services/notificationsLog.js';

let transporter = null;
let testOverride = null;

export function emailEnabled() {
  return Boolean(config.notifications?.email?.enabled);
}

function getTransporter() {
  if (testOverride) return testOverride;
  if (transporter) return transporter;
  const cfg = config.notifications.email.smtp ?? {};
  transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port ?? 587,
    secure: cfg.secure ?? false,
    auth: cfg.user ? { user: cfg.user, pass: config.smtpPassword } : undefined,
  });
  return transporter;
}

/**
 * Send an email. Every attempt writes a row to notifications_log:
 *   - 'pending' before the transport call
 *   - 'sent' on success, 'failed' (with error message) on throw
 *
 * `event` is a free-form tag for the log (e.g. 'signed_in', 'test_email').
 * Defaults to 'unspecified' if the caller forgets to pass it.
 */
export async function sendEmail({ to, subject, text, html, event = 'unspecified' }) {
  if (!emailEnabled() && !testOverride) return;
  if (!to || (Array.isArray(to) && to.length === 0)) return;

  const recipient = Array.isArray(to) ? to.join(',') : to;
  const logId = createPending({ kind: 'email', event, recipient, subject });

  try {
    const info = await getTransporter().sendMail({
      from: config.notifications.email.from,
      to: recipient,
      subject,
      text,
      html,
    });
    markSent(logId);
    logger.info({ messageId: info.messageId, to: recipient }, 'email sent');
    return info;
  } catch (err) {
    markFailed(logId, err);
    logger.error({ err: err.message, to: recipient }, 'email send failed');
    throw err;
  }
}

/** Test seam: pass an object with a sendMail({ from, to, subject, text, html }) → { messageId } method. */
export function setTransportForTests(t) {
  testOverride = t;
  transporter = null;
}
