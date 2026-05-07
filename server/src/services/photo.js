import { mkdirSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { db } from '../db/index.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { getSetting } from './settings.js';

const PHOTO_DIR = resolve(config.dataDir, 'photos');
const RETENTION_DAYS = 30;

export function photoEnabled() {
  return Boolean(getSetting('photo.enabled'));
}

/**
 * Decode the base64 PNG and write it to disk under data/photos/visit-{id}.png.
 * Updates the visit row's photo_path. Caller is responsible for opt-in
 * gating (i.e. ignoring photoPngBase64 entirely when photo.enabled is false).
 */
export function storePhoto({ visitId, photoPngBase64 }) {
  if (!photoPngBase64) return null;
  mkdirSync(PHOTO_DIR, { recursive: true });
  const cleaned = photoPngBase64.replace(/^data:image\/png;base64,/, '');
  const buf = Buffer.from(cleaned, 'base64');
  const file = `visit-${visitId}.png`;
  writeFileSync(resolve(PHOTO_DIR, file), buf);
  const relPath = `photos/${file}`;
  db.prepare('UPDATE visits SET photo_path = ? WHERE id = ?').run(relPath, visitId);
  return relPath;
}

export function photoFileFor(visitId) {
  const r = db.prepare('SELECT photo_path FROM visits WHERE id = ?').get(visitId);
  if (!r?.photo_path) return null;
  const abs = resolve(config.dataDir, r.photo_path);
  if (!existsSync(abs)) return null;
  return abs;
}

/**
 * Sweep: delete photo files for visits older than RETENTION_DAYS, null the
 * column. Returns count of purged rows. Idempotent and cheap to run hourly.
 */
export function purgeExpiredPhotos() {
  const rows = db.prepare(`
    SELECT id, photo_path FROM visits
    WHERE photo_path IS NOT NULL
      AND datetime(signed_in_at) < datetime('now', '-' || ? || ' days')
  `).all(RETENTION_DAYS);

  let purged = 0;
  for (const r of rows) {
    const abs = resolve(config.dataDir, r.photo_path);
    if (existsSync(abs)) {
      try { unlinkSync(abs); } catch (err) { logger.warn({ err: err.message, file: abs }, 'photo unlink failed'); }
    }
    db.prepare('UPDATE visits SET photo_path = NULL WHERE id = ?').run(r.id);
    purged++;
  }
  if (purged > 0) logger.info({ purged }, 'expired visitor photos purged');
  return purged;
}

let sweepHandle = null;
const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily

export function startPhotoRetentionSweep() {
  if (sweepHandle) return;
  // Run once on startup so a long-down workshop catches up immediately.
  try { purgeExpiredPhotos(); } catch (err) { logger.error({ err: err.message }, 'photo sweep failed'); }
  sweepHandle = setInterval(() => {
    try { purgeExpiredPhotos(); } catch (err) { logger.error({ err: err.message }, 'photo sweep failed'); }
  }, SWEEP_INTERVAL_MS);
  // Don't keep the process alive just for this timer.
  sweepHandle.unref?.();
}

export function stopPhotoRetentionSweep() {
  if (sweepHandle) clearInterval(sweepHandle);
  sweepHandle = null;
}
