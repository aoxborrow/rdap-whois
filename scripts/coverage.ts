#!/usr/bin/env tsx
// Writes docs/coverage.md: for every zone the routing data knows (each TLD, and the
// second-level zones with a registry of their own), its RDAP server, its WHOIS server, the
// parser format that server's responses are read with, how many recorded responses test
// that server, and each server's status in the last registry-health run. Then the same for
// the WHOIS servers no zone is routed to, mostly registrars reached by referral. Everything comes
// from the committed routing data, the fixture corpus and registry-health/state.json, so
// the output changes only when those do.
//
// It also writes the README's headline numbers, between the coverage markers there, from
// the routing data and the fixtures only, so the README changes when those do and not with
// each week's server status.
//
// Run:   npm run coverage
// Check: npm run coverage -- --check  (fails when the page or the README is stale)
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { formatConfig, resolveFormat } from '../src/whois/formats';
import { tldRoute, tldRoutes } from '../src/tlds';
import { getRdapServer } from '../src/rdap/servers';
import { normalizeRdapServer } from '../src/rdap/utils';
import { HEALTH_DIR, PACKAGE_DIR, WHOIS_FIXTURES_DIR } from './lib/paths';

const OUT_FILE = `${PACKAGE_DIR}docs/coverage.md`;
const README_FILE = `${PACKAGE_DIR}README.md`;
const README_START = '<!-- coverage:start';
const README_END = '<!-- coverage:end -->';

type HealthEntry = { classification: string; consecutiveFailures: number };
type HealthState = {
  updatedAt: string;
  whois: Record<string, HealthEntry>;
  rdap: Record<string, HealthEntry>;
};

type Row = {
  zone: string;
  rdap: string | null;
  rdapHealth: string;
  whois: string | null;
  whoisHealth: string;
  format: string | null;
  ownConfig: boolean;
  fixtures: number;
};

// what each registry-health classification means, in the words the page uses
const HEALTH_LABELS: Record<string, string> = {
  'healthy': 'ok',
  'throttled': 'ok',
  'notfound-fp': 'misreads',
  'suspect': 'suspect',
  'error': 'suspect',
  'refused': 'refuses',
  'dead-candidate': 'failing',
};

const testCount = (counts: number[]): number => counts.reduce((sum, n) => sum + n, 0);

// the test count of each WHOIS server zones are routed to, once per server: one server can
// serve many zones
function zoneServerTests(rows: Row[]): number[] {
  const byServer = new Map<string, number>();
  for (const row of rows) if (row.whois && row.fixtures > 0) byServer.set(row.whois, row.fixtures);
  return [...byServer.values()];
}

const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, 'utf8')) as T;

// recorded responses with a golden beside them, per server
function fixtureCounts(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const file of readdirSync(`${WHOIS_FIXTURES_DIR}found/`)) {
    if (!file.endsWith('.json') || !file.includes('___')) continue;
    const server = file.split('___')[0];
    counts.set(server, (counts.get(server) ?? 0) + 1);
  }
  return counts;
}

function health(entry: HealthEntry | undefined): string {
  if (!entry) return 'not probed';
  return HEALTH_LABELS[entry.classification] ?? entry.classification;
}

function buildRows(state: HealthState): Row[] {
  const fixtures = fixtureCounts();
  const zones = tldRoutes()
    .map(([zone]) => zone)
    .sort((a, b) => a.localeCompare(b));
  return zones.map(zone => {
    // a name inside the zone, so the RDAP lookup walks to this zone and no further
    const rdap = getRdapServer('domain', `example.${zone}`);
    const whois = tldRoute(zone)?.whois ?? null;
    const rdapKey = rdap ? normalizeRdapServer(rdap) : null;
    return {
      zone,
      rdap,
      rdapHealth: rdap ? health(state.rdap[rdapKey ?? rdap] ?? state.rdap[rdap]) : '',
      whois,
      whoisHealth: whois ? health(state.whois[whois]) : '',
      format: whois ? resolveFormat(whois).name : null,
      ownConfig: whois ? formatConfig(whois) !== undefined : false,
      fixtures: whois ? (fixtures.get(whois) ?? 0) : 0,
    };
  });
}

type OtherServer = {
  server: string;
  health: string;
  format: string;
  ownConfig: boolean;
  fixtures: number;
};

// the WHOIS servers with recorded tests that no zone is routed to: registrars a registry
// referred to, and a few registry hosts the routing data no longer uses
function buildOtherServers(rows: Row[], state: HealthState): OtherServer[] {
  const routed = new Set(rows.map(row => row.whois).filter(Boolean));
  return [...fixtureCounts()]
    .filter(([server]) => !routed.has(server))
    .sort(([a, countA], [b, countB]) => countB - countA || a.localeCompare(b))
    .map(([server, fixtures]) => ({
      server,
      health: health(state.whois[server]),
      format: resolveFormat(server).name,
      ownConfig: formatConfig(server) !== undefined,
      fixtures,
    }));
}

function render(rows: Row[], others: OtherServer[], state: HealthState): string {
  const tlds = rows.filter(row => !row.zone.includes('.'));
  const count = (list: Row[], test: (row: Row) => boolean): number => list.filter(test).length;
  const summary = (label: string, test: (row: Row) => boolean): string =>
    `| ${label} | ${count(tlds, test)} | ${count(rows, test)} |`;

  const lines = [
    '# Coverage',
    '',
    '<!-- generated by scripts/coverage.ts from the routing data, the fixture corpus and',
    '     registry-health/state.json; edit those, then run `npm run coverage` -->',
    '',
    'Which zones the library can look up, over which protocol, and how well. A zone is a TLD,',
    'or a second-level zone with a registry of its own (`co.uk` is not one, `br.com` is).',
    '',
    `Server status is from the registry-health run of ${state.updatedAt.slice(0, 10)}, which`,
    'probes every server weekly with a name known to be registered:',
    '',
    '- **ok**: answered with a record, or with a rate-limit notice',
    '- **misreads**: answered, but said the registered name does not exist',
    '- **suspect**: answered with something empty or odd',
    '- **refuses**: answered with an error of its own, such as "TLD is not supported"',
    '- **failing**: timed out or could not be reached; a server stays routed until repeated',
    '  failures, IANA and a working RDAP server agree it can go',
    '- **not probed**: not in the last run',
    '',
    '**Parser** is the format the WHOIS server’s responses are read with. A name in bold is a',
    'format tuned for that server (its own file in `src/whois/servers/`); the others use the',
    'format as it is. **Tests** counts the recorded responses from that server checked against',
    'the parse expected of them.',
    '',
    '## Summary',
    '',
    '|  | TLDs | All zones |',
    '| --- | ---: | ---: |',
    summary('Zones', () => true),
    summary('RDAP', row => row.rdap !== null),
    summary('WHOIS', row => row.whois !== null),
    summary('RDAP or WHOIS', row => row.rdap !== null || row.whois !== null),
    summary('Neither: no lookup possible', row => row.rdap === null && row.whois === null),
    summary('WHOIS only', row => row.rdap === null && row.whois !== null),
    summary('WHOIS server with a tuned parser', row => row.ownConfig),
    summary('WHOIS server with recorded tests', row => row.fixtures > 0),
    summary('RDAP ok', row => row.rdapHealth === 'ok'),
    summary('WHOIS ok', row => row.whoisHealth === 'ok'),
    '',
    `Recorded tests: ${testCount(zoneServerTests(rows))} responses from ${zoneServerTests(rows).length}`,
    `WHOIS servers that zones are routed to (they serve ${count(rows, row => row.fixtures > 0)} zones), and`,
    `${testCount(others.map(other => other.fixtures))} from ${others.length} other servers,`,
    'mostly registrars ([below](#registrars-and-other-servers)).',
    '',
    '## Zones',
    '',
    '| Zone | RDAP | Status | WHOIS | Status | Parser | Tests |',
    '| --- | --- | --- | --- | --- | --- | ---: |',
  ];
  for (const row of rows) {
    const format = row.format ? (row.ownConfig ? `**${row.format}**` : row.format) : '';
    lines.push(
      `| ${row.zone} | ${row.rdap ?? ''} | ${row.rdapHealth} | ${row.whois ?? ''} | ${row.whoisHealth} | ${format} | ${row.fixtures || ''} |`
    );
  }
  lines.push(
    '',
    '## Registrars and other servers',
    '',
    'WHOIS servers with recorded tests that no zone is routed to: mostly registrars, reached',
    'when a registry refers a lookup to the registrar, and a few registry hosts the routing',
    'data no longer uses. A server is matched to its parser format by hostname, so any',
    'registrar not listed here, and any listed without a bold format, is read with the',
    'generic key-value format. That reads the response format ICANN requires of accredited',
    'registrars; a registrar that departs from it is not covered until it gets a config of',
    'its own. Status is shown only for the servers the health run probes.',
    '',
    '| Server | Status | Parser | Tests |',
    '| --- | --- | --- | ---: |'
  );
  for (const other of others) {
    const format = other.ownConfig ? `**${other.format}**` : other.format;
    const status = other.health === 'not probed' ? '' : other.health;
    lines.push(`| ${other.server} | ${status} | ${format} | ${other.fixtures} |`);
  }
  return lines.join('\n') + '\n';
}

// the README's headline numbers: TLDs only, and nothing from the health state
function renderReadmeBlock(rows: Row[], others: OtherServer[]): string {
  const tlds = rows.filter(row => !row.zone.includes('.'));
  const count = (test: (row: Row) => boolean): string =>
    tlds.filter(test).length.toLocaleString('en-US');
  return [
    `${README_START}: written by \`npm run coverage\` from the routing data and the fixtures -->`,
    `- **${count(row => row.rdap !== null || row.whois !== null)} of ${count(() => true)} TLDs** - ${count(row => row.rdap !== null)} over RDAP and ${count(row => row.whois !== null)} over WHOIS (the other ${count(row => row.rdap === null && row.whois === null)} publish no server),`,
    `  with WHOIS formats tuned for the servers of ${count(row => row.ownConfig)} TLDs and recorded responses testing ${count(row => row.fixtures > 0)} TLDs and ${others.length} registrars.`,
    '  Every zone is listed in [docs/coverage.md](https://github.com/aoxborrow/rdap-whois/blob/main/docs/coverage.md)',
    README_END,
  ].join('\n');
}

// the README with its coverage block replaced
function withReadmeBlock(readme: string, block: string): string {
  const start = readme.indexOf(README_START);
  const end = readme.indexOf(README_END);
  if (start === -1 || end < start) throw new Error('README.md has no coverage markers');
  return readme.slice(0, start) + block + readme.slice(end + README_END.length);
}

function main(): void {
  const state = readJson<HealthState>(`${HEALTH_DIR}state.json`);
  const rows = buildRows(state);
  const others = buildOtherServers(rows, state);
  const page = render(rows, others, state);
  const currentReadme = readFileSync(README_FILE, 'utf8');
  const readme = withReadmeBlock(currentReadme, renderReadmeBlock(rows, others));

  if (process.argv.includes('--check')) {
    const current = existsSync(OUT_FILE) ? readFileSync(OUT_FILE, 'utf8') : '';
    const stale = [
      ...(current !== page ? ['docs/coverage.md'] : []),
      ...(currentReadme !== readme ? ['README.md'] : []),
    ];
    if (stale.length) {
      console.error(
        `${stale.join(' and ')} ${stale.length > 1 ? 'are' : 'is'} stale: run \`npm run coverage\` and commit the result`
      );
      process.exit(1);
    }
    console.log('docs/coverage.md and the README numbers are current');
    return;
  }

  mkdirSync(dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, page, 'utf8');
  writeFileSync(README_FILE, readme, 'utf8');
  console.log(`wrote ${OUT_FILE} and the numbers in ${README_FILE}`);
}

main();
