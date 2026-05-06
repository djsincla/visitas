import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { logger } from '../logger.js';

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

export async function sendEmail({ to, subject, text, html }) {
  if (!emailEnabled() && !testOverride) return;
  if (!to || (Array.isArray(to) && to.length === 0)) return;

  const info = await getTransporter().sendMail({
    from: config.notifications.email.from,
    to: Array.isArray(to) ? to.join(',') : to,
    subject,
    text,
    html,
  });
  logger.info({ messageId: info.messageId, to }, 'email sent');
  return info;
}

/** Test seam: pass an object with a sendMail({ from, to, subject, text, html }) → { messageId } method. */
export function setTransportForTests(t) {
  testOverride = t;
  transporter = null;
}
