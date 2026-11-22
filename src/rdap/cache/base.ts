import { RdapServerCache, ServerCacheBootstrap } from '../types';
import { normalizeRdapServer } from '../utils';

export abstract class BaseServerCache implements RdapServerCache {
  bootstrap: ServerCacheBootstrap;
  cache: Map<string, string>;

  protected constructor(bootstrap: ServerCacheBootstrap) {
    this.bootstrap = bootstrap;
    this.cache = new Map();
    this.initCache();
  }

  initCache() {
    for (const service of this.bootstrap.services) {
      const server = normalizeRdapServer(service[1][0]);
      for (const pattern of service[0]) {
        this.cache.set(pattern, server);
      }
    }
  }

  entries(): [string, string][] {
    return Array.from(this.cache.entries());
  }

  getServer(query: string): string | null {
    return this.cache.get(query) || null;
  }

  allServers(): string[] {
    return Array.from(new Set(this.cache.values()));
  }

  hasServer(server: string): boolean {
    for (const known of this.cache.values()) if (known === server) return true;
    return false;
  }
}
