// script to resolve the routing layers into the committed routing table, data/tlds.json
import fs from 'fs';
import { normalizeServer } from '../../src/common/utils';
import { normalizeRdapServer } from '../../src/rdap/utils';
import type { RdapSource, TldRoute, WhoisSource } from '../../src/tlds';
import {
  GENERATED_DIR,
  RDAP_DATA_DIR,
  SHARED_GENERATED_DIR,
  TLDS_FILE,
  WHOIS_DATA_DIR,
} from '../lib/paths';

export type TldMap = Record<string, string | null>;

// Read a layer FRESH from disk. Deliberately NOT static `import … from '@/data/whois/*.json'`:
// those bind at module load, but whois-health.ts mutates tlds-auto.json (via the
// `whois:update-tlds` child process) and tlds-phaseout.json (in-process) DURING a run and
// then calls getTldServers() for the decision — a module-load snapshot would feed decide()
// stale routing (a TLD that just gained/lost a server this sweep). Every caller is offline
// tooling (registry-health scripts + the lockstep test); runtime routes off the committed
// data/tlds.json, so re-reading a few small JSONs per call costs nothing at request time.
function loadLayer(file: string): TldMap {
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as TldMap) : {};
}

// src/generated/tlds-updated.ts, the day the WHOIS table last changed and the day IANA
// published the RDAP bootstrap. A module of its own, so DATA_VERSION, which the package root
// exports, loads neither the table nor the bootstrap file with it
const updatedFile = `${SHARED_GENERATED_DIR}tlds-updated.ts`;

// The WHOIS layers, lowest first:
//   ascii      static snapshot, originally from https://github.com/WooMai/whois-servers —
//              all TLDs punycode, punycode collisions combined
//   extra      second-level pseudo-TLDs (uk.com, za.net, …) and other additions the IANA
//              sweep can't see — IANA only covers real top-level domains
//   auto       machine-swept per-TLD `whois:` referrals from whois.iana.org
//              (scripts/whois/update-tlds.ts, `whois:update-tlds`)
//   discovered probe-verified replacement servers for TLDs whose routed server went dead,
//              found from community lists (`whois:discover`, §10.4). Append-only: the job
//              only ever writes verified-alive servers here, never nulls. Symmetric with
//              the RDAP discovered layer.
//   phaseout   decided phase-outs — TLDs routed to null after the full §6 gate (dead ≥90d
//              + ≥3 probe failures + IANA dropped the line + working RDAP), written by
//              scripts/whois/decide.ts
//   overrides  hand-maintained, always wins
const WHOIS_LAYERS: readonly WhoisSource[] = [
  'ascii',
  'extra',
  'auto',
  'discovered',
  'phaseout',
  'overrides',
];

// THE merge. The table below, prune-overrides.ts (registry-health §10.4) and the health
// scripts read the layer algebra from here — it has two asymmetric null rules that are easy
// to get subtly wrong when restated, so there is exactly one statement of it.
//
// The two null rules: an AUTO null only fills a TLD with no existing entry (fresh IANA
// truth beats the static snapshot for servers, but IANA dropping its `whois:` line alone
// must not null a still-working server — hundreds of TLDs rely on this). A PHASEOUT null
// DOES override everything below it — that's the whole point of the decision, and it's
// gated on probe evidence + IANA agreement (docs/registry-health.md §6).
//
// Values come back as written (un-normalized), each with the layer it came from;
// getTldServers() normalizes, and prune-overrides compares through its own normalizer.
export function mergeTldLayersWithSources({ includeOverrides = true } = {}): Record<
  string,
  { host: string | null; source: WhoisSource }
> {
  const merged: Record<string, { host: string | null; source: WhoisSource }> = {};
  for (const source of WHOIS_LAYERS) {
    if (source === 'overrides' && !includeOverrides) continue;
    for (const [tld, host] of Object.entries(loadLayer(`${WHOIS_DATA_DIR}tlds-${source}.json`))) {
      if (source === 'auto' && host === null && Object.hasOwn(merged, tld)) continue;
      merged[tld] = { host, source };
    }
  }
  return merged;
}

export function mergeTldLayers({ includeOverrides = true } = {}): TldMap {
  return Object.fromEntries(
    Object.entries(mergeTldLayersWithSources({ includeOverrides })).map(([tld, { host }]) => [
      tld,
      host,
    ])
  );
}

export function getTldServers(): TldMap {
  return Object.fromEntries(
    Object.entries(mergeTldLayers()).map(([tld, host]) => [
      tld,
      host ? normalizeServer(host) : null,
    ])
  );
}

interface RdapBootstrap {
  publication: string;
  services: [string[], string[]][];
}

const loadBootstrap = (): RdapBootstrap =>
  JSON.parse(fs.readFileSync(`${RDAP_DATA_DIR}dns.json`, 'utf8')) as RdapBootstrap;

export type RdapRoutes = Record<string, { base: string | null; source: RdapSource }>;

// Apply one RDAP layer onto the routes, in place. A non-null URL sets or replaces the route
// for that zone — keyed lowercase, normalized to the canonical form the bootstrap routes use
// (via normalizeRdapServer), so a discovered endpoint and its later probe record share a
// key. An explicit null removes the route (a way to retract a dead bootstrap entry and
// force whois-only); the zone keeps a null base with the layer that removed it
export function applyRdapLayer(routes: RdapRoutes, layer: TldMap, source: RdapSource): void {
  for (const [zone, url] of Object.entries(layer)) {
    routes[zone.toLowerCase()] = { base: url === null ? null : normalizeRdapServer(url), source };
  }
}

// The RDAP layers: IANA's bootstrap file (data/rdap/dns.json), then servers found by probing
// registries that IANA does not list (dns-discovered.json), then hand-kept corrections
// (dns-overrides.json), which win. The bootstrap's first URL for a service is its server
export function mergeRdapLayers(): RdapRoutes {
  const routes: RdapRoutes = {};
  for (const [zones, urls] of loadBootstrap().services) {
    const base = normalizeRdapServer(urls[0]);
    for (const zone of zones) routes[zone] = { base, source: 'iana' };
  }
  applyRdapLayer(routes, loadLayer(`${RDAP_DATA_DIR}dns-discovered.json`), 'discovered');
  applyRdapLayer(routes, loadLayer(`${RDAP_DATA_DIR}dns-overrides.json`), 'overrides');
  return routes;
}

// every zone with an RDAP route, read fresh from the layers: zone → base URL
export function getRdapRoutes(): Record<string, string> {
  const routes: Record<string, string> = {};
  for (const [zone, { base }] of Object.entries(mergeRdapLayers())) if (base) routes[zone] = base;
  return routes;
}

// the resolved table: every zone a layer names, sorted, with its WHOIS server and RDAP base
// in the exact forms the library routes by and registry-health/state.json keys health on.
// A null server with a source is one that layer removed; a null source means no layer of
// that protocol names the zone
export function resolveTlds(): Record<string, TldRoute> {
  const whois = mergeTldLayersWithSources();
  const rdap = mergeRdapLayers();
  const zones = [...new Set([...Object.keys(whois), ...Object.keys(rdap)])].sort();
  return Object.fromEntries(
    zones.map(zone => {
      const w = Object.hasOwn(whois, zone) ? whois[zone] : undefined;
      const r = Object.hasOwn(rdap, zone) ? rdap[zone] : undefined;
      const route: TldRoute = {
        whois: w?.host ? normalizeServer(w.host) : null,
        whoisSource: w?.source ?? null,
        rdap: r?.base ?? null,
        rdapSource: r?.source ?? null,
      };
      return [zone, route];
    })
  );
}

// one zone per line, so the weekly diff shows each changed route on its own line
export function serializeTlds(tlds: Record<string, TldRoute>): string {
  const lines = Object.entries(tlds).map(
    ([zone, route]) => `  ${JSON.stringify(zone)}: ${JSON.stringify(route)}`
  );
  return `{\n${lines.join(',\n')}\n}\n`;
}

// src/whois/generated/zones.ts, the zones below a TLD that the map routes on their own
const zonesFile = `${GENERATED_DIR}zones.ts`;

// the zones below a TLD that have a registry of their own in the map (ac.uk, br.com), which
// registrableDomain() counts as suffixes beside the public suffix list. Kept apart from the
// map so that the root entry, which loads the WHOIS side lazily, can import them
export function registryZones(map: TldMap = getTldServers()): string[] {
  return Object.keys(map)
    .filter(zone => zone.includes('.'))
    .sort();
}

// the WHOIS table a routing table holds: zone → server, for the zones a WHOIS layer names
const whoisTable = (tlds: Record<string, TldRoute>): TldMap =>
  Object.fromEntries(
    Object.entries(tlds)
      .filter(([, route]) => route.whoisSource !== null)
      .map(([zone, route]) => [zone, route.whois])
  );

// Write data/tlds.json and the two modules generated with it. Every script that changes a
// routing layer calls this, so the committed table never lags the layers it comes from
export function writeTlds(): void {
  const tlds = resolveTlds();
  const read = (file: string) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');

  // the WHOIS table keeps the date it last changed on (DATA_VERSION.whoisTables): a run that
  // produces the same WHOIS table keeps the old date
  const previous = read(TLDS_FILE);
  const unchanged =
    previous !== '' &&
    JSON.stringify(whoisTable(JSON.parse(previous) as Record<string, TldRoute>)) ===
      JSON.stringify(whoisTable(tlds));
  const updated =
    (unchanged && /TLD_TABLE_UPDATED = '([\d-]+)'/.exec(read(updatedFile))?.[1]) ||
    new Date().toISOString().slice(0, 10);

  fs.writeFileSync(TLDS_FILE, serializeTlds(tlds), 'utf8');
  fs.writeFileSync(
    zonesFile,
    `// Generated by scripts/whois/generate-tlds.ts from the layers in data/whois/. Do not
// edit by hand: change a layer, then run \`npm run whois:generate:tlds\`

export const REGISTRY_ZONES: readonly string[] = ${JSON.stringify(registryZones(whoisTable(tlds)), null, 2)};
`,
    'utf8'
  );
  fs.writeFileSync(
    updatedFile,
    `// Generated by scripts/whois/generate-tlds.ts with data/tlds.json. Do not edit by hand

// the day the WHOIS table in data/tlds.json last changed
export const TLD_TABLE_UPDATED = '${updated}';

// the day IANA published the RDAP bootstrap file for domains (data/rdap/dns.json)
export const RDAP_BOOTSTRAP_PUBLISHED = '${loadBootstrap().publication.slice(0, 10)}';
`,
    'utf8'
  );
  console.log(`routing table generated at ${TLDS_FILE} (${Object.keys(tlds).length} zones)`);
}

// only run the file write when called directly
if (import.meta.url.endsWith(process.argv[1])) {
  writeTlds();
}
