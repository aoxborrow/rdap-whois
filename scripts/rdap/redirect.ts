import type { RdapQueryType } from '../../src/rdap/types';
import { getRdapQueryPath } from '../../src/rdap/utils';
import { TOOLING_USER_AGENT, toolingFetch } from '../lib/client';

// rdap.org's no-redirect (404) path can take ~8-12s, so the default allows extra time;
// sweep-style callers pass a tighter timeout and accept the occasional false null
const DEFAULT_TIMEOUT_MS = 15_000;

// The RDAP URL rdap.org redirects a query to, or null when it does not redirect. rdap.org
// knows some servers that are not registered with IANA, so the discovery lanes ask it for
// TLDs that have no RDAP route. Each call goes through the tooling's fetch, which behind the
// rotating proxy opens its own tunnel, so a sweep is spread over many exit addresses
export async function getRdapOrgRedirectUrl(
  queryType: RdapQueryType,
  query: string,
  timeout = DEFAULT_TIMEOUT_MS
): Promise<string | null> {
  const url = `https://rdap.org/${getRdapQueryPath(queryType, query)}`;
  try {
    const response = await toolingFetch(timeout)(url, {
      method: 'GET',
      headers: {
        // rdap.org is Cloudflare-fronted and 403s requests without a User-Agent
        'User-Agent': TOOLING_USER_AGENT,
        'Accept': 'application/json,application/rdap+json',
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(timeout),
    });
    await response.body?.cancel();
    if (response.status >= 300 && response.status < 400) {
      return response.headers.get('location') || null;
    }
  } catch (error) {
    // message only — timeouts/aborts are routine here and full stacks are noise
    console.error(
      'Error fetching rdap.org redirectURL:',
      error instanceof Error ? error.message : error
    );
  }
  return null;
}
