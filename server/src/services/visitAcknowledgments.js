import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { db } from '../db/index.js';
import { config } from '../config.js';

const SIG_DIR = resolve(config.dataDir, 'signatures');

/**
 * Record an acknowledgment row for a visit. If `signaturePngBase64` is
 * provided (NDA case), decodes and writes it to data/signatures/visit-{id}-{kind}.png
 * and stores the relative path on the row.
 *
 * Returns the inserted row.
 */
export function recordAcknowledgment({ visitId, documentId, kind, signedName = null, signaturePngBase64 = null }) {
  let signaturePath = null;
  if (signaturePngBase64) {
    mkdirSync(SIG_DIR, { recursive: true });
    const cleaned = signaturePngBase64.replace(/^data:image\/png;base64,/, '');
    const buf = Buffer.from(cleaned, 'base64');
    const file = `visit-${visitId}-${kind}.png`;
    writeFileSync(resolve(SIG_DIR, file), buf);
    signaturePath = `signatures/${file}`;
  }

  const info = db.prepare(`
    INSERT INTO visit_acknowledgments (visit_id, document_id, signed_name, signature_path)
    VALUES (?, ?, ?, ?)
  `).run(visitId, documentId, signedName, signaturePath);
  return db.prepare('SELECT * FROM visit_acknowledgments WHERE id = ?').get(info.lastInsertRowid);
}

export function loadAcknowledgmentsForVisit(visitId) {
  return db.prepare(`
    SELECT a.*, d.kind, d.version, d.title
    FROM visit_acknowledgments a
    JOIN documents d ON d.id = a.document_id
    WHERE a.visit_id = ?
    ORDER BY a.id ASC
  `).all(visitId).map(r => ({
    id: r.id,
    kind: r.kind,
    documentVersion: r.version,
    documentTitle: r.title,
    signedName: r.signed_name,
    signaturePath: r.signature_path,
    acknowledgedAt: r.acknowledged_at,
  }));
}
