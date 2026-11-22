import { normalizeRdapServer } from '../utils';

// A domain-RDAP override layer: tld → base URL, or null. IANA's bootstrap file misses some
// RDAP servers that registries run, and lists a few that are dead; a layer adds or removes
// those. See DnsServerCache for the order the layers apply in.
export type RdapOverrideLayer = Record<string, string | null>;

// Apply one layer onto an RDAP pattern → server cache, in place. A non-null URL sets or
// replaces the route for that TLD — keyed lowercase, normalized to the same canonical form the bootstrap cache uses
// (via normalizeRdapServer), so a discovered endpoint and its later probe record share a
// key. An explicit null removes any route (a way to retract a dead bootstrap entry and
// force whois-only). Layers are applied in precedence order by the caller.
export function applyRdapOverrides(cache: Map<string, string>, layer: RdapOverrideLayer): void {
  for (const [tld, url] of Object.entries(layer)) {
    const pattern = tld.toLowerCase();
    if (url === null) {
      cache.delete(pattern);
    } else {
      cache.set(pattern, normalizeRdapServer(url));
    }
  }
}
