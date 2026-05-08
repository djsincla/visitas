// PNG magic-byte signature: 137 80 78 71 13 10 26 10
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

/** Returns true if `buf` is a Buffer beginning with the PNG signature. */
export function isPng(buf) {
  return Buffer.isBuffer(buf) && buf.length >= 8 && buf.subarray(0, 8).equals(PNG_MAGIC);
}

/**
 * Throws an httpError(400) if `buf` doesn't begin with the PNG signature.
 * Use this on every base64 → Buffer conversion before writing to disk —
 * a hostile client could otherwise upload arbitrary binary that lands at
 * a `.png` path and gets served with `Content-Type: image/png`.
 */
export function assertPng(buf, message = 'invalid PNG') {
  if (!isPng(buf)) {
    const err = new Error(message);
    err.status = 400;
    throw err;
  }
}
