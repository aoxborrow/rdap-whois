import { tldRoutes } from '../../tlds';
import { BaseServerCache } from './base';
import { RDAP_BOOTSTRAP_PUBLISHED } from '../../generated/tlds-updated';

export class DnsServerCache extends BaseServerCache {
  constructor() {
    // the resolved routing table (data/tlds.json): IANA's bootstrap file
    // (https://data.iana.org/rdap/dns.json), with the servers found by probing registries
    // IANA does not list and the hand-kept corrections merged over it at build time
    super({
      description: 'RDAP routes for domains from data/tlds.json',
      publication: RDAP_BOOTSTRAP_PUBLISHED,
      services: [],
      version: '1.0',
    });
  }

  initCache() {
    for (const [zone, route] of tldRoutes()) {
      if (route.rdap) this.cache.set(zone, route.rdap);
    }
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
