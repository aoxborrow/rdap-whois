// weppos/whois (Ruby gem) discovery source (docs/registry-health.md §10.4). The gem ships
// its TLD server map as data/tld.json — a second community-maintained whois-host list,
// independent of Debian's, so a useful cross-check and occasional extra coverage. Keys are
// bare TLDs (no leading dot); an entry carries a `host` only when it has a port-43 server
// (entries with `"adapter": "none"` or web-only have none and are skipped).
import type { DiscoverySource } from '../../registry-health/discovery';

const TLD_JSON_URL = 'https://raw.githubusercontent.com/weppos/whois/main/data/tld.json';

type WepposEntry = { host?: string; adapter?: string; _type?: string };

async function loadMap(): Promise<Map<string, string>> {
  const res = await fetch(TLD_JSON_URL);
  if (!res.ok) throw new Error(`weppos tld.json ${res.status} ${res.statusText}`);
  const data = (await res.json()) as Record<string, WepposEntry>;
  const map = new Map<string, string>();
  for (const [key, entry] of Object.entries(data)) {
    if (key.startsWith('_')) continue; // metadata row (e.g. "_": { schema, updated })
    const host = entry?.host;
    if (host && host.includes('.') && !host.includes('/')) {
      map.set(key.replace(/^\./, '').toLowerCase(), host.toLowerCase());
    }
  }
  return map;
}

let cache: Map<string, string> | null = null;

export const wepposSource: DiscoverySource = {
  name: 'weppos/whois',
  async lookup(tld) {
    cache ??= await loadMap();
    const host = cache.get(tld.replace(/^\./, '').toLowerCase());
    return { servers: host ? [host] : [] };
  },
  async loadAll() {
    cache ??= await loadMap();
    return cache;
  },
};
