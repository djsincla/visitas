import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { emailEnabled } from './email.js';

/**
 * Email a copy of the signed NDA to the visitor.
 *
 * Best-effort — if email is disabled, the visitor has no email, the
 * signature file is missing, or SMTP errors out, we log and return.
 * The sign-in flow does not fail because of this.
 */
export async function sendVisitorNdaCopy({ visit, document, signaturePath, signedAt }) {
  if (!emailEnabled()) return;
  if (!visit?.email) return;
  if (!document) return;

  const sigAbs = signaturePath ? resolve(config.dataDir, signaturePath) : null;
  const hasSig = sigAbs && existsSync(sigAbs);

  const subject = `[visitas.world] Your signed NDA — ${escape(document.title)}`;
  const text = [
    `${visit.visitorName},`,
    '',
    `This is a copy of the non-disclosure agreement you signed at the kiosk.`,
    '',
    `Document: ${document.title} (v${document.version})`,
    `Signed: ${signedAt}`,
    '',
    document.body,
    '',
    '— visitas.world',
  ].join('\n');

  const sigCid = 'visitor-nda-signature@visitas';
  const html = renderHtml({ visit, document, signedAt, hasSig, sigCid });

  // Lazy-build a transport — same shape as notifications/email.js, but we
  // use a fresh transport so the email helper's testOverride doesn't
  // accidentally swallow visitor mail in tests. Tests can swap this whole
  // function via setSenderForTests below.
  if (testOverride) {
    return testOverride({ to: visit.email, subject, text, html, hasSig });
  }
  const cfg = config.notifications.email.smtp ?? {};
  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port ?? 587,
    secure: cfg.secure ?? false,
    auth: cfg.user ? { user: cfg.user, pass: config.smtpPassword } : undefined,
  });

  try {
    await transporter.sendMail({
      from: config.notifications.email.from,
      to: visit.email,
      subject,
      text,
      html,
      attachments: hasSig ? [{
        filename: 'signature.png',
        content: readFileSync(sigAbs),
        cid: sigCid,
        contentType: 'image/png',
      }] : [],
    });
    logger.info({ to: visit.email, visitId: visit.id }, 'visitor NDA copy emailed');
  } catch (err) {
    logger.error({ err: err.message, visitId: visit.id }, 'visitor NDA email failed');
  }
}

let testOverride = null;
/** Test seam: pass an async function that intercepts the mail send. */
export function setVisitorNdaSenderForTests(fn) {
  testOverride = fn;
}

function renderHtml({ visit, document, signedAt, hasSig, sigCid }) {
  const body = String(document.body)
    .split(/\n{2,}/)
    .map(p => `<p style="margin: 0 0 12px; line-height: 1.5;">${escape(p).replace(/\n/g, '<br />')}</p>`)
    .join('');

  return `<!doctype html>
<html><head><meta charset="utf-8" /></head>
<body style="font-family: -apple-system, system-ui, sans-serif; color: #111; max-width: 640px; margin: 0 auto; padding: 24px;">
  <p>Hi ${escape(visit.visitorName)},</p>
  <p>Below is a copy of the non-disclosure agreement you signed at the kiosk. Keep this email for your records.</p>
  <hr style="border: none; border-top: 1px solid #ddd; margin: 24px 0;" />
  <h1 style="margin: 0 0 8px; font-size: 18px;">${escape(document.title)}</h1>
  <p style="color: #666; font-size: 13px; margin: 0 0 16px;">Version ${document.version} &middot; signed ${escape(signedAt)}</p>
  ${body}
  <hr style="border: none; border-top: 1px solid #ddd; margin: 24px 0;" />
  <p><strong>Signed by:</strong> ${escape(visit.visitorName)}</p>
  ${hasSig ? `<p><img src="cid:${sigCid}" alt="signature" style="max-width: 320px; border: 1px solid #eee; padding: 8px; background: #fff;" /></p>` : ''}
  <p style="color: #888; font-size: 12px; margin-top: 24px;">— visitas.world</p>
</body></html>`;
}

function escape(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
