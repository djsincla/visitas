import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role, source: user.source },
    config.jwt.secret,
    { expiresIn: config.jwt.ttlSeconds, issuer: 'visitas' },
  );
}

export function verifyToken(token) {
  return jwt.verify(token, config.jwt.secret, { issuer: 'visitas' });
}

export const COOKIE_NAME = 'visitas_session';

export function cookieOptions() {
  return {
    httpOnly: true,
    // 'strict' rather than 'lax': the visitor app has no cross-site
    // navigation we want to carry the session for. A user clicking an
    // /admin/... link from email will hit the SPA logged-out and need to
    // sign in — that's a fair price for closing the lax-cookie CSRF gap
    // on any future GET-with-side-effects endpoint.
    sameSite: 'strict',
    secure: config.env === 'production',
    maxAge: config.jwt.ttlSeconds * 1000,
    path: '/',
  };
}
