// Debian whois discovery source (docs/registry-health.md §10.4) — the canonical
// community whois-server map (Marco d'Itri's rfc1036/whois, what `whois(1)` ships). Often
// ahead of IANA and the origin of many existing overrides.
//
// The full Debian map is TWO layers (docs/registry-health.md S1), mirroring the
// client's own precedence ("tld_serv_list will be checked first"):
//   new_gtlds_list  ~1,500 bare gTLDs, one per line, each meaning "query whois.nic.<tld>"
//                   — synthesized first
//   tld_serv_list   the exception list, overlaid on top. Format: one entry per line,
//                   "<.tld>  <directive...>". The directive is a whois host, or a keyword
//                   (NONE / WEB <url> / RECURSIVE) or a keyword-then-host (VERISIGN <host>,
//                   …). We take the first hostname-looking token — that captures both
//                   plain hosts and the keyword-prefixed ones. A keyword-only entry
//                   (NONE/WEB/RECURSIVE — no port-43 host) REMOVES any synthesized entry:
//                   Debian is saying "don't whois this one".
// Comments (#) and blank lines are ignored in both files.
import type { DiscoverySource } from '../../registry-health/discovery';

const TLD_SERV_LIST_URL = 'https://raw.githubusercontent.com/rfc1036/whois/next/tld_serv_list';
const NEW_GTLDS_LIST_URL = 'https://raw.githubusercontent.com/rfc1036/whois/next/new_gtlds_list';

// a bare hostname token (has a dot, letters TLD, no scheme/slash) — not NONE/WEB/a URL
const HOSTNAME = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;

async function fetchList(url: string): Promise<string[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url.split('/').pop()} ${res.status} ${res.statusText}`);
  const text = await res.text();
  return text
    .split('\n')
    .map(line => line.replace(/#.*$/, '').trim())
    .filter(Boolean);
}

async function loadMap(): Promise<Map<string, string>> {
  const [gtlds, servList] = await Promise.all([
    fetchList(NEW_GTLDS_LIST_URL),
    fetchList(TLD_SERV_LIST_URL),
  ]);
  const map = new Map<string, string>();
  // layer 1: every new gTLD answers at whois.nic.<tld>
  for (const line of gtlds) {
    const tld = line.toLowerCase();
    map.set(tld, `whois.nic.${tld}`);
  }
  // layer 2: the exception list wins — a host replaces, a keyword-only entry removes
  for (const line of servList) {
    const [rawTld, ...rest] = line.split(/\s+/);
    const tld = rawTld.replace(/^\./, '').toLowerCase();
    if (!tld) continue;
    const host = rest.find(token => HOSTNAME.test(token) && !token.includes('/'));
    if (host) map.set(tld, host.toLowerCase());
    else map.delete(tld);
  }
  return map;
}

let cache: Map<string, string> | null = null;

export const debianWhoisSource: DiscoverySource = {
  name: 'debian/whois',
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
