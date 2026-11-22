import dnsBootstrap from '../../../data/rdap/dns.json';
import dnsDiscovered from '../../../data/rdap/dns-discovered.json';
import dnsOverrides from '../../../data/rdap/dns-overrides.json';
import { BaseServerCache } from './base';
import { applyRdapOverrides, type RdapOverrideLayer } from './overrides';

export class DnsServerCache extends BaseServerCache {
  constructor() {
    // https://data.iana.org/rdap/dns.json
    super(dnsBootstrap);
    // Over IANA's bootstrap file go two layers: servers found by probing registries that
    // IANA does not list, then hand-kept corrections, which win. Order:
    // bootstrap ← discovered ← overrides.
    applyRdapOverrides(this.cache, dnsDiscovered);
    applyRdapOverrides(this.cache, dnsOverrides);
  }

  getServer(query: string): string | null {
    const zone = this.zone(query);
    return zone === null ? null : this.cache.get(zone)!;
  }

  // the zone above a name that the data has a server for: the longest one, e.g. the TLD
  zone(query: string): string | null {
    if (!query || query.length === 0) return null;
    while (query.includes('.')) {
      query = query.substring(query.indexOf('.') + 1);
      if (this.cache.get(query)) return query;
    }
    return this.cache.get(query) ? query : null;
  }

  // the zones below a TLD that have a server of their own
  subZones(): string[] {
    return [...this.cache.keys()].filter(zone => zone.includes('.'));
  }
}
