import { config } from '../config.js';
import { logger } from '../logger.js';
import { db } from '../db/index.js';
import { sendEmail, emailEnabled } from './email.js';
import { sendSms, smsEnabled } from './sms.js';

/**
 * Fire host notifications for a visit event.
 *
 * event: 'signed_in' | 'signed_out' | 'force_signed_out'
 * visit: the visit record (must have host fields populated, or host_user_id)
 * actor: user object (admin/security) for force_signed_out events; null otherwise
 *
 * Fire-and-forget by default — the caller doesn't await. Errors are logged.
 * Tests can `await notifyVisitEvent(...)` directly to drive the dispatch.
 */
export async function notifyVisitEvent(event, { visit, actor = null } = {}) {
  if (!visit) return;
  if (!emailEnabled() && !smsEnabled()) return;

  const host = loadHost(visit);
  if (!host) return;

  const subject = subjectFor(event, visit, host);
  const body = bodyFor(event, visit, actor);

  const tasks = [];
  if (emailEnabled() && wantsChannel('email', event) && host.email) {
    tasks.push(
      sendEmail({ to: host.email, subject, text: body })
        .catch(err => logger.error({ err: err.message, event, hostId: host.id }, 'email notify failed'))
    );
  }
  if (smsEnabled() && wantsChannel('sms', event) && host.phone) {
    tasks.push(
      sendSms({ to: host.phone, body: `${subject}\n${body}` })
        .catch(err => logger.error({ err: err.message, event, hostId: host.id }, 'sms notify failed'))
    );
  }
  await Promise.allSettled(tasks);
}

/** Schedule notifyVisitEvent for fire-and-forget dispatch (does not block the caller). */
export function notifyVisitEventAsync(event, payload) {
  setImmediate(() => {
    notifyVisitEvent(event, payload).catch(err => {
      logger.error({ err: err.message, event }, 'notify dispatch failed');
    });
  });
}

/**
 * Banned sign-in attempt → email + SMS to all active admin + security
 * users so the floor team can intercept the visitor at the door. Uses the
 * same per-channel events filter (event name 'signin_blocked').
 *
 * Best-effort: failures logged, never propagated.
 */
export async function notifySigninBlocked({ ban, attempt }) {
  if (!emailEnabled() && !smsEnabled()) return;

  const recipients = db.prepare(`
    SELECT id, email, phone, display_name, username
    FROM users
    WHERE active = 1 AND role IN ('admin','security')
  `).all();
  if (recipients.length === 0) return;

  const subject = `[visitas.world] Banned sign-in attempt — ${attempt.visitorName ?? 'unknown'}`;
  const body = [
    `A banned sign-in attempt was just blocked at the kiosk.`,
    '',
    `Visitor: ${attempt.visitorName ?? '—'}${attempt.company ? ` (${attempt.company})` : ''}`,
    `Email: ${attempt.email ?? '—'}`,
    `Kiosk: ${attempt.kioskSlug ?? 'default'}`,
    '',
    `Ban id: ${ban.id} (mode: ${ban.mode})`,
    `Reason: ${ban.reason}`,
    '',
    `Reception: please intercept the visitor and explain politely.`,
  ].join('\n');

  const tasks = [];
  for (const r of recipients) {
    if (emailEnabled() && wantsChannel('email', 'signin_blocked') && r.email) {
      tasks.push(
        sendEmail({ to: r.email, subject, text: body })
          .catch(err => logger.error({ err: err.message, userId: r.id }, 'signin_blocked email failed'))
      );
    }
    if (smsEnabled() && wantsChannel('sms', 'signin_blocked') && r.phone) {
      tasks.push(
        sendSms({ to: r.phone, body: `${subject}\n${attempt.visitorName ?? '—'} blocked at ${attempt.kioskSlug ?? 'default'} kiosk` })
          .catch(err => logger.error({ err: err.message, userId: r.id }, 'signin_blocked sms failed'))
      );
    }
  }
  await Promise.allSettled(tasks);
}

export function notifySigninBlockedAsync(payload) {
  setImmediate(() => {
    notifySigninBlocked(payload).catch(err => {
      logger.error({ err: err.message }, 'signin_blocked dispatch failed');
    });
  });
}

function loadHost(visit) {
  // Service layer returns visit.host = { id, username, displayName }, but
  // we also want email + phone for delivery. Re-query when present.
  const id = visit.host?.id ?? visit.host_user_id;
  if (!id) return null;
  return db.prepare(
    'SELECT id, username, email, display_name, phone FROM users WHERE id = ? AND active = 1',
  ).get(id);
}

function wantsChannel(channel, event) {
  const events = config.notifications?.[channel]?.events;
  if (!Array.isArray(events) || !events.length) return true;
  return events.includes(event);
}

function subjectFor(event, visit, host) {
  const hostName = host.display_name || host.username;
  const visitor = visit.visitorName ?? visit.visitor_name ?? 'A visitor';
  switch (event) {
    case 'signed_in':         return `[visitas.world] ${visitor} is here to see ${hostName}`;
    case 'signed_out':        return `[visitas.world] ${visitor} has signed out`;
    case 'force_signed_out':  return `[visitas.world] ${visitor} was signed out by reception`;
    default:                  return `[visitas.world] visit ${event}: ${visitor}`;
  }
}

function bodyFor(event, visit, actor) {
  const visitor = visit.visitorName ?? visit.visitor_name ?? 'visitor';
  const company = visit.company ? ` from ${visit.company}` : '';
  const purpose = visit.purpose ? `Reason: ${visit.purpose}` : null;

  const lines = [];
  switch (event) {
    case 'signed_in':
      lines.push(`${visitor}${company} just signed in at the visitor kiosk to see you.`);
      if (purpose) lines.push(purpose);
      lines.push('They are waiting in reception.');
      break;
    case 'signed_out':
      lines.push(`${visitor} has signed out at the kiosk.`);
      break;
    case 'force_signed_out': {
      const by = actor ? `${actor.display_name || actor.username} (${actor.role})` : 'reception';
      lines.push(`${visitor} was signed out by ${by} (force sign-out).`);
      break;
    }
    default:
      lines.push(`Visit event: ${event}`);
  }
  return lines.join('\n');
}
