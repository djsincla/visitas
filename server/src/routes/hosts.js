import { Router } from 'express';
import { db } from '../db/index.js';

const router = Router();

// Public: the kiosk needs the host list to render the typeahead. Sanitized:
// only id + displayName, no phone/email/role. Filtered to active role=admin
// users (security users are not hosts). Trust-the-LAN model — anyone on the
// LAN can read this.
router.get('/', (_req, res) => {
  const rows = db.prepare(`
    SELECT id, username, display_name
    FROM users
    WHERE role = 'admin' AND active = 1
    ORDER BY display_name COLLATE NOCASE, username COLLATE NOCASE
  `).all();
  res.json({
    hosts: rows.map(r => ({
      id: r.id,
      displayName: r.display_name || r.username,
    })),
  });
});

export default router;
