import { Client as LdaptsClient } from 'ldapts';
import { config } from '../config.js';
import { logger } from '../logger.js';

let testClientFactory = null;

/** Test seam: pass a function `() => fakeClient` that returns an ldapts-like client. */
export function setClientFactoryForTests(fn) {
  testClientFactory = fn;
}

function newClient() {
  if (testClientFactory) return testClientFactory();
  const ad = config.auth.ad;
  return new LdaptsClient({
    url: ad.url,
    tlsOptions: { rejectUnauthorized: ad.tlsRejectUnauthorized !== false },
    timeout: 10_000,
    connectTimeout: 10_000,
  });
}

export function adEnabled() {
  return Boolean(config.auth?.ad?.enabled);
}

/**
 * Authenticate against AD/LDAP.
 *
 * Returns:
 *   - { username, email, displayName, groups[] } on a successful bind whose
 *     account is allowed by the configured group (visitas-world).
 *   - null on bad credentials, missing entry, or group-disallowed.
 *   - throws on connection / configuration errors (the caller surfaces 503).
 */
export async function authenticateAD(username, password) {
  const ad = config.auth?.ad;
  if (!ad?.enabled) return null;

  const client = newClient();

  try {
    await client.bind(ad.bindDN, config.adBindPassword);

    const filter = (ad.searchFilter ?? '(sAMAccountName={username})')
      .replaceAll('{username}', escapeLdap(username));

    const { searchEntries } = await client.search(ad.searchBase, {
      filter,
      scope: 'sub',
      attributes: ['dn', 'cn', 'memberOf',
        ad.attributes?.username ?? 'sAMAccountName',
        ad.attributes?.email ?? 'mail',
        ad.attributes?.displayName ?? 'displayName',
      ],
    });

    if (searchEntries.length === 0) return null;
    const entry = searchEntries[0];

    // Re-bind as the user with their credentials.
    try { await client.unbind(); } catch {}
    const userClient = newClient();
    try {
      await userClient.bind(entry.dn, password);
    } catch (err) {
      if (err?.code === 49 /* invalid credentials */) return null;
      throw err;
    } finally {
      try { await userClient.unbind(); } catch {}
    }

    const groups = toArray(entry.memberOf);
    if (!userInAllowedGroup(groups)) {
      logger.warn({ username }, 'AD user rejected by allowedGroup');
      return null;
    }

    return {
      username: String(entry[ad.attributes?.username ?? 'sAMAccountName'] ?? username),
      email: stringOrNull(entry[ad.attributes?.email ?? 'mail']),
      displayName: stringOrNull(entry[ad.attributes?.displayName ?? 'displayName']) ?? username,
      groups,
    };
  } catch (err) {
    logger.error({ err: err.message }, 'AD authentication error');
    throw err;
  } finally {
    try { await client.unbind(); } catch {}
  }
}

/**
 * Returns true if the AD user's memberOf list contains a DN that
 * substring-matches the configured allowedGroup (case-insensitive).
 *
 * If allowedGroup is empty or unset, any authenticated AD user is allowed.
 * That's a corner case — the workshop normally pins to `visitas-world`.
 */
export function userInAllowedGroup(adGroups) {
  const pattern = config.auth?.ad?.allowedGroup;
  if (!pattern) return true;
  return (adGroups ?? []).some(g => groupMatches(pattern, g));
}

function groupMatches(pattern, dn) {
  if (!pattern || !dn) return false;
  return String(dn).toLowerCase().includes(String(pattern).toLowerCase());
}

function escapeLdap(s) {
  return String(s).replace(/[\\*() ]/g, c => `\\${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
}

function stringOrNull(v) {
  if (v == null) return null;
  if (Array.isArray(v)) return v[0] ?? null;
  return String(v);
}

function toArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v.map(String) : [String(v)];
}
