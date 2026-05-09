import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { resetDb, client, row } from './helpers.js';
import { config } from '../src/config.js';
import { setClientFactoryForTests, userInAllowedGroup, assertAdBindCredentials } from '../src/auth/ad.js';

const ORIGINAL_AUTH = JSON.parse(JSON.stringify(config.auth));

/**
 * Factory that returns a fresh fake ldapts Client per call. The first call
 * is the service-account client (does bind + search); the second call is
 * the user-rebind client (does a single bind to verify the password). When
 * userBindRejects is true, the second factory call's bind throws code 49.
 */
function fakeFactory({ entry, userBindRejects = false } = {}) {
  let calls = 0;
  return () => {
    calls++;
    const isUserClient = calls >= 2;
    return {
      async bind(_dn, _pw) {
        if (isUserClient && userBindRejects) {
          const e = new Error('invalid credentials');
          e.code = 49;
          throw e;
        }
      },
      async search() { return { searchEntries: entry ? [entry] : [] }; },
      async unbind() {},
    };
  };
}

const ORIGINAL_BIND_PW = config.adBindPassword;

function configureAD(overrides = {}) {
  config.auth = JSON.parse(JSON.stringify(ORIGINAL_AUTH));
  config.auth.ad = {
    enabled: true,
    url: 'ldaps://ad.test',
    bindDN: 'cn=svc,dc=test',
    searchBase: 'dc=test',
    searchFilter: '(sAMAccountName={username})',
    tlsRejectUnauthorized: false,
    allowedGroup: 'visitas-world',
    attributes: { username: 'sAMAccountName', email: 'mail', displayName: 'displayName' },
    ...overrides,
  };
  // Provide a non-empty bind password by default so existing tests don't trip
  // the assertAdBindCredentials() guard. Tests that exercise the missing-
  // password path explicitly clear it.
  config.adBindPassword = 'test-bind-pw';
}

describe('assertAdBindCredentials', () => {
  afterEach(() => {
    config.auth = JSON.parse(JSON.stringify(ORIGINAL_AUTH));
    config.adBindPassword = ORIGINAL_BIND_PW;
  });

  test('no-op when AD is disabled', () => {
    config.auth = { ...ORIGINAL_AUTH, ad: { enabled: false } };
    expect(() => assertAdBindCredentials()).not.toThrow();
  });

  test('no-op when bindDN is unset (anonymous-bind by design)', () => {
    configureAD({ bindDN: undefined });
    const original = config.adBindPassword;
    config.adBindPassword = '';
    try { expect(() => assertAdBindCredentials()).not.toThrow(); }
    finally { config.adBindPassword = original; }
  });

  test('throws when AD enabled, bindDN set, bind password empty', () => {
    configureAD();
    const original = config.adBindPassword;
    config.adBindPassword = '';
    try {
      expect(() => assertAdBindCredentials()).toThrow(/AD_BIND_PASSWORD/);
    } finally {
      config.adBindPassword = original;
    }
  });

  test('passes when bind password is present', () => {
    configureAD();
    const original = config.adBindPassword;
    config.adBindPassword = 'svc-pass';
    try { expect(() => assertAdBindCredentials()).not.toThrow(); }
    finally { config.adBindPassword = original; }
  });
});

describe('userInAllowedGroup', () => {
  test('matches case-insensitive substring on DN', () => {
    configureAD();
    expect(userInAllowedGroup(['cn=Visitas-World,ou=Groups,dc=test'])).toBe(true);
    expect(userInAllowedGroup(['CN=VISITAS-WORLD,OU=Groups,DC=Test'])).toBe(true);
    expect(userInAllowedGroup(['cn=Other-Group,dc=test'])).toBe(false);
    expect(userInAllowedGroup([])).toBe(false);
  });

  test('empty allowedGroup means any AD user accepted', () => {
    configureAD({ allowedGroup: '' });
    expect(userInAllowedGroup([])).toBe(true);
  });
});

describe('AD login', () => {
  beforeEach(resetDb);
  afterEach(() => {
    setClientFactoryForTests(null);
    config.auth = JSON.parse(JSON.stringify(ORIGINAL_AUTH));
    config.adBindPassword = ORIGINAL_BIND_PW;
  });

  test('AD user in visitas-world group → success → upserted as admin/source=ad', async () => {
    configureAD();
    setClientFactoryForTests(fakeFactory({
      entry: {
        dn: 'cn=Alice,dc=test',
        sAMAccountName: 'alice',
        mail: 'alice@example.com',
        displayName: 'Alice Example',
        memberOf: ['cn=visitas-world,ou=Groups,dc=test'],
      },
    }));


    const res = await client().post('/api/auth/login').send({ username: 'alice', password: 'secret' });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      username: 'alice', source: 'ad', role: 'admin', email: 'alice@example.com', displayName: 'Alice Example',
    });

    const stored = row('SELECT * FROM users WHERE username = ?', 'alice');
    expect(stored.source).toBe('ad');
    expect(stored.role).toBe('admin');
    expect(stored.password_hash).toBeNull();
  });

  test('AD user NOT in visitas-world group → 401', async () => {
    configureAD();
    setClientFactoryForTests(fakeFactory({
      entry: {
        dn: 'cn=Bob,dc=test',
        sAMAccountName: 'bob',
        mail: 'bob@example.com',
        displayName: 'Bob',
        memberOf: ['cn=other-group,ou=Groups,dc=test'],
      },
    }));


    const res = await client().post('/api/auth/login').send({ username: 'bob', password: 'secret' });
    expect(res.status).toBe(401);
  });

  test('returning AD user → email + displayName refreshed', async () => {
    configureAD();
    setClientFactoryForTests(fakeFactory({
      entry: {
        dn: 'cn=Alice,dc=test', sAMAccountName: 'alice',
        mail: 'alice@old.com', displayName: 'Alice Old',
        memberOf: ['cn=visitas-world,dc=test'],
      },
    }));

    await client().post('/api/auth/login').send({ username: 'alice', password: 'secret' });

    setClientFactoryForTests(fakeFactory({
      entry: {
        dn: 'cn=Alice,dc=test', sAMAccountName: 'alice',
        mail: 'alice@new.com', displayName: 'Alice New',
        memberOf: ['cn=visitas-world,dc=test'],
      },
    }));

    const res = await client().post('/api/auth/login').send({ username: 'alice', password: 'secret' });
    expect(res.body.user.email).toBe('alice@new.com');
    expect(res.body.user.displayName).toBe('Alice New');
  });

  test('AD disabled → AD user cannot log in (falls through to local)', async () => {
    config.auth = { ...ORIGINAL_AUTH, ad: { enabled: false } };
    setClientFactoryForTests(fakeFactory({ entry: {} })); // never called
    const res = await client().post('/api/auth/login').send({ username: 'alice', password: 'secret' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid credentials/);
  });

  test('local username collision: local takes precedence', async () => {
    configureAD();
    setClientFactoryForTests(fakeFactory({
      entry: {
        dn: 'cn=admin,dc=test', sAMAccountName: 'admin',
        mail: 'ad-admin@example.com', displayName: 'AD Admin',
        memberOf: ['cn=visitas-world,dc=test'],
      },
    }));


    // The bootstrap admin (admin/admin) is local. AD entry with same username
    // exists. Login with 'admin'/'admin' should hit local first and succeed.
    const res = await client().post('/api/auth/login').send({ username: 'admin', password: 'admin' });
    expect(res.status).toBe(200);
    expect(res.body.user.source).toBe('local');
  });

  test('bad AD password (search-then-rebind fails) → 401', async () => {
    configureAD();
    setClientFactoryForTests(fakeFactory({
      entry: {
        dn: 'cn=Alice,dc=test', sAMAccountName: 'alice',
        mail: 'alice@example.com', displayName: 'Alice',
        memberOf: ['cn=visitas-world,dc=test'],
      },
      userBindRejects: true,
    }));


    const res = await client().post('/api/auth/login').send({ username: 'alice', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  test('enabled AD with empty bind password → authenticateAD throws (defense in depth)', async () => {
    configureAD();
    const original = config.adBindPassword;
    config.adBindPassword = '';
    try {
      const res = await client().post('/api/auth/login').send({ username: 'alice', password: 'secret' });
      // Login surfaces an internal error as 503 (handled in routes/auth.js).
      expect([500, 503]).toContain(res.status);
    } finally {
      config.adBindPassword = original;
    }
  });

  test('AD upserted user appears in /api/hosts after login', async () => {
    configureAD();
    setClientFactoryForTests(fakeFactory({
      entry: {
        dn: 'cn=Alice,dc=test', sAMAccountName: 'alice',
        mail: 'alice@example.com', displayName: 'Alice Example',
        memberOf: ['cn=visitas-world,dc=test'],
      },
    }));

    await client().post('/api/auth/login').send({ username: 'alice', password: 'secret' });

    const res = await client().get('/api/hosts');
    const names = res.body.hosts.map(h => h.displayName);
    expect(names).toContain('Alice Example');
  });
});
