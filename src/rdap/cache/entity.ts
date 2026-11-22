import entityBootstrap from '../../../data/rdap/object-tags.json';
import { BaseServerCache } from './base';
import { normalizeRdapServer } from '../utils';

export class EntityServerCache extends BaseServerCache {
  constructor() {
    // https://data.iana.org/rdap/object-tags.json
    super(entityBootstrap);
  }

  // object-tags.json has a bit different structure, so we need to override initCache
  initCache() {
    for (const service of this.bootstrap.services) {
      const server = normalizeRdapServer(service[2][0]);
      for (const pattern of service[1]) {
        this.cache.set(pattern, server);
      }
    }
  }

  // the server for an entity handle, by its service provider tag: the part after the last
  // hyphen, as in "NET-ARIN" or "ORG-RIPE" (RFC 8521). A handle with no tag in the file
  // has no server
  getServer(query: string): string | null {
    const hyphen = query.lastIndexOf('-');
    if (hyphen === -1) return null;
    const tag = query.slice(hyphen + 1).toLowerCase();
    for (const [known, server] of this.entries()) {
      if (known.toLowerCase() === tag) return server;
    }
    return null;
  }
}
