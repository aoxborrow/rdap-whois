// script to create auto-generated whois server TLD map
import fs from 'fs';
import path from 'path';
import { normalizeServer } from '../../src/common/utils';
import { GENERATED_DIR, WHOIS_DATA_DIR } from '../lib/paths';

export type TldMap = Record<string, string | null>;

// the routing data layers, data/whois/
const dataDir = WHOIS_DATA_DIR;

// Read a layer FRESH from disk. Deliberately NOT static `import … from '@/data/whois/*.json'`:
// those bind at module load, but whois-health.ts mutates tlds-auto.json (via the
// `whois:update-tlds` child process) and tlds-phaseout.json (in-process) DURING a run and
// then calls getTldServers() for the decision — a module-load snapshot would feed decide()
// stale routing (a TLD that just gained/lost a server this sweep). Every caller is offline
// tooling (registry-health scripts + the lockstep test); runtime routes off the committed
// generated/whois/tlds.ts, so re-reading six small JSONs per call costs nothing at request time.
function loadLayer(name: string): TldMap {
  const p = path.join(dataDir, name);
  return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, 'utf8')) as TldMap) : {};
}

// src/whois/generated/tlds.ts, which src/whois/servers.ts imports TLD_SERVERS from
const outputFile = `${GENERATED_DIR}tlds.ts`;
// src/whois/generated/tlds-updated.ts, the day the table last changed. A module of its own,
// so DATA_VERSION, which the package root exports, does not load the table with it
const updatedFile = `${GENERATED_DIR}tlds-updated.ts`;

// THE merge. Both the codegen below and prune-overrides.ts (registry-health §10.4) read the
// layer algebra from here — it has two asymmetric null rules that are easy to get subtly
// wrong when restated, so there is exactly one statement of it.
//
// Layers, lowest first:
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
//
// The two null rules: an AUTO null only fills a TLD with no existing entry (fresh IANA
// truth beats the static snapshot for servers, but IANA dropping its `whois:` line alone
// must not null a still-working server — hundreds of TLDs rely on this). A PHASEOUT null
// DOES override everything below it — that's the whole point of the decision, and it's
// gated on probe evidence + IANA agreement (docs/registry-health.md §6).
//
// Values come back as written (un-normalized); getTldServers() normalizes, and
// prune-overrides compares through its own normalizer. Layers are read fresh per call (see
// loadLayer) so a mid-run refresh of tlds-auto/tlds-phaseout is reflected.
export function mergeTldLayers({ includeOverrides = true } = {}): TldMap {
  const merged: TldMap = { ...loadLayer('tlds-ascii.json'), ...loadLayer('tlds-extra.json') };
  for (const [tld, host] of Object.entries(loadLayer('tlds-auto.json'))) {
    if (host !== null || !(tld in merged)) {
      merged[tld] = host;
    }
  }
  Object.assign(merged, loadLayer('tlds-discovered.json'));
  Object.assign(merged, loadLayer('tlds-phaseout.json'));
  if (includeOverrides) {
    Object.assign(merged, loadLayer('tlds-overrides.json'));
  }
  return merged;
}

export function getTldServers(): TldMap {
  return Object.fromEntries(
    Object.entries(mergeTldLayers()).map(([tld, host]) => [
      tld,
      host ? normalizeServer(host) : null,
    ])
  );
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

// only run the file write when called directly
if (import.meta.url.endsWith(process.argv[1])) {
  const tldServers = getTldServers();
  fs.writeFileSync(
    zonesFile,
    `// Generated by scripts/whois/generate-tlds.ts from the layers in data/whois/. Do not
// edit by hand: change a layer, then run \`npm run whois:generate:tlds\`

export const REGISTRY_ZONES: readonly string[] = ${JSON.stringify(registryZones(tldServers), null, 2)};
`,
    'utf8'
  );

  // ensure the output directory exists
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });

  // the table keeps the date it last changed on (DATA_VERSION.whoisTables): a run that
  // produces the same table keeps the old date
  const table = JSON.stringify(tldServers, null, 2);
  const read = (file: string) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');
  const unchanged = read(outputFile).includes(`= ${table};`);
  const updated =
    (unchanged && /TLD_TABLE_UPDATED = '([\d-]+)'/.exec(read(updatedFile))?.[1]) ||
    new Date().toISOString().slice(0, 10);

  // write the tld map
  const fileContent = `// Generated by scripts/whois/generate-tlds.ts from the layers in data/whois/. Do not
// edit by hand: change a layer, then run \`npm run whois:generate:tlds\`

export const TLD_SERVERS: Record<string, string | null> = ${table};
`;

  fs.writeFileSync(outputFile, fileContent, 'utf8');
  fs.writeFileSync(
    updatedFile,
    `// Generated by scripts/whois/generate-tlds.ts with tlds.ts. Do not edit by hand

// the day the TLD table in tlds.ts last changed
export const TLD_TABLE_UPDATED = '${updated}';
`,
    'utf8'
  );
  console.log(`TLD_SERVERS generated at ${outputFile}`);
}
