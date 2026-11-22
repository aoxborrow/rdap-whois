import { describe, expect, it, vi } from 'vitest';
import type { RdapQueryType } from '../../../src/rdap/types';
import { getRdapOrgRedirectUrl } from '../../../scripts/rdap/redirect';

const LIVE = process.env.LIVE === '1';

// Every case below is one live request to rdap.org — a free, Cloudflare-fronted
// service that rate-limits per IP (~10 per burst window, 429 beyond it). Keep this
// suite to the minimum that proves the function works: one case per query type plus
// ONE null path. Broad rdap.org sweeps belong to the registry-health probe harness,
// which classifies 429 as "alive, throttled" instead of failing.
//
// Cut from 7 cases to 5 (~40s → ~13s): rdap.org redirects by TLD bootstrap, not by
// registration state, so testing both an existing and a non-existent domain proved the
// same thing twice — and the invalid-IP null path proved nothing the unsupported-TLD null
// path doesn't. The survivors run CONCURRENTLY: five calls is comfortably inside the burst
// window, and each builds its own agent (below), so they don't even share an exit IP.
//
// Each call opens its own connection (through the rotating proxy when one is configured,
// see scripts/lib/client.ts), so each egresses from a different IP in the pool and the
// suite does not trip the burst limit.
//
// Skipped unless LIVE=1, like the library's live suite.
describe.skipIf(!LIVE)('getRdapOrgRedirectUrl (live)', () => {
  // rdap.org's no-redirect (404) path can take several seconds, and the function's
  // own HTTP timeout is 15s — test timeout must sit above that.
  vi.setConfig({ testTimeout: 45000 });

  // expect a specific redirect URL, retrying on null with backoff: a rotating-pool
  // exit can be transiently dead or pre-throttled by other tenants of the shared
  // pool. A real regression (e.g. rdap.org 403ing a missing User-Agent) fails every
  // attempt deterministically, so retries don't mask it.
  async function expectRedirectUrl(queryType: RdapQueryType, query: string, expected: string) {
    let result = await getRdapOrgRedirectUrl(queryType, query);
    for (let attempt = 0; result === null && attempt < 2; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      result = await getRdapOrgRedirectUrl(queryType, query);
    }
    expect(result).toBe(expected);
  }

  describe.concurrent('domain queries', () => {
    it('should return null for TLDs that do not support RDAP', async () => {
      // .gr has no RDAP registered with IANA (and rdap.org 404s it quickly)
      const result = await getRdapOrgRedirectUrl('domain', 'domain.gr');
      expect(result).toBeNull();
    });

    // one domain case is enough: the redirect comes from the TLD bootstrap, not from whether
    // the name is registered, so a non-existent name under a supported TLD is the stricter
    // of the two and covers both
    it('should return RDAP URL for supported TLD with non-existent domain', async () => {
      await expectRedirectUrl(
        'domain',
        'fakr1z4.org',
        'https://rdap.publicinterestregistry.org/rdap/domain/fakr1z4.org'
      );
    });
  });

  describe.concurrent('ip queries', () => {
    it('should return RDAP URL for valid IP', async () => {
      await expectRedirectUrl('ip', '8.8.8.8', 'https://rdap.arin.net/registry/ip/8.8.8.8');
    });
  });

  describe.concurrent('autnum queries', () => {
    it('should return RDAP URL for valid ASN', async () => {
      await expectRedirectUrl('asn', '15169', 'https://rdap.arin.net/registry/autnum/15169');
    });
  });

  describe.concurrent('entity queries', () => {
    it('should return RDAP URL for valid entity', async () => {
      await expectRedirectUrl(
        'entity',
        'ABUSE5250-ARIN',
        'https://rdap.arin.net/registry/entity/abuse5250-arin'
      );
    });
  });
});
