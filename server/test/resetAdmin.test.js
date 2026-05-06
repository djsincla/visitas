import { describe, test, expect, beforeEach } from 'vitest';
import { resetDb, client, row } from './helpers.js';
import { resetUser, generatePassword } from '../src/cli/reset-admin.js';
import { db } from '../src/db/index.js';

describe('reset-admin CLI', () => {
  beforeEach(resetDb);

  test('generated password meets complexity rules', () => {
    for (let i = 0; i < 8; i++) {
      const pw = generatePassword();
      expect(pw.length).toBeGreaterThanOrEqual(20);
      expect(pw).toMatch(/[A-Z]/);
      expect(pw).toMatch(/[a-z]/);
      expect(pw).toMatch(/[0-9]/);
    }
  });

  test('reset of existing admin works and forces password change', async () => {
    const r = resetUser({ username: 'admin', password: 'NewPass1234' });
    expect(r.action).toBe('reset');

    const after = row('SELECT must_change_password, active FROM users WHERE username = ?', 'admin');
    expect(after.must_change_password).toBe(1);
    expect(after.active).toBe(1);

    const login = await client().post('/api/auth/login').send({ username: 'admin', password: 'NewPass1234' });
    expect(login.status).toBe(200);
  });

  test('reactivates a disabled account', () => {
    db.prepare("UPDATE users SET active = 0 WHERE username = 'admin'").run();
    resetUser({ username: 'admin', password: 'NewPass1234' });
    const after = row('SELECT active FROM users WHERE username = ?', 'admin');
    expect(after.active).toBe(1);
  });

  test('creates a new admin if missing', async () => {
    const r = resetUser({ username: 'admin2', password: 'NewPass1234' });
    expect(r.action).toBe('created');

    const u = row('SELECT role, must_change_password FROM users WHERE username = ?', 'admin2');
    expect(u.role).toBe('admin');
    expect(u.must_change_password).toBe(1);
  });

  test('refuses to reset an AD-sourced user', () => {
    db.prepare(`INSERT INTO users (username, source, role) VALUES ('aduser', 'ad', 'admin')`).run();
    expect(() => resetUser({ username: 'aduser', password: 'NewPass1234' }))
      .toThrow(/AD-sourced/);
  });
});
