#!/usr/bin/env tsx
// Probe the registrar server list (registry-health/registrars.json) and fold the outcomes into
// registry-health/state.json under `registrars`, keyed by IANA registrar ID. Each distinct WHOIS
// server and RDAP base is probed once, with the same harness and classification as the TLD
// servers (a conformant RDAP 404 is live), and every registrar on it gets that outcome.
//
// Probe query: for a WHOIS server, a domain the fixture corpus recorded a record for on it; then
// a domain a registry confirmed one of its registrars sponsors (its own domain first); else the
// domain of the server's own hostname, which is usually registered with the registrar that runs
// it.
//
// Also measures how well the library parses registrar WHOIS: of the servers that answered with a
// record, how many came out with the record's core fields (registry-health/registrar-report.json,
// summarized in report.md). --dump DIR writes each answer there for a closer look.
//
// Run: npm run registrars:check-servers [--limit N] [--sample N] [--no-save] [--dump DIR]
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { registrableDomain } from '../../src/registrable';
import type { RdapWhois } from '../../src/index';
import { toolingClient } from '../lib/client';
import { HEALTH_DIR, WHOIS_FIXTURES_DIR } from '../lib/paths';
import { probeRdapBase } from '../rdap/probe/rdap-probe';
import { probeWhoisServer } from '../whois/probe/whois-probe';
import {
  loadState,
  recordProbe,
  runPool,
  sampleN,
  saveState,
  type ProbeClassification,
  type ProbeRecord,
  type RegistrarHealth,
} from '../registry-health/state';
import { persistThrottling } from '../registry-health/throttling';
import { coverage, loadRegistrars, type RegistrarEntry } from './registrars';
import { REGISTRAR_REPORT_FILE, type RegistrarReport } from './report';

const WHOIS_CONCURRENCY = 8;
const RDAP_CONCURRENCY = 6;
const PACE_MS = 150;

// a WHOIS answer counts as parsed when this many of DOMAIN_REQUIRED_FIELDS came out (13 in
// all; an ICANN-format registrar answer gives 11 or more, a redacted one still 9)
export const PARSED_MIN_SCORE = 7;

type Outcome = { classification: ProbeClassification; detail?: string; score?: number };
type Endpoint = { key: string; query: string; ids: string[] };

function getFlag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : undefined;
}

// server → a domain the fixture corpus recorded a record for on it
function corpusQueries(): Map<string, string> {
  const map = new Map<string, string>();
  for (const file of readdirSync(`${WHOIS_FIXTURES_DIR}found/`)) {
    if (!file.endsWith('.txt')) continue;
    const [server, query] = file.slice(0, -4).split('___');
    if (server && query && !map.has(server)) map.set(server, query);
  }
  return map;
}

// the distinct servers of one protocol, each with the registrars on it and the query to ask
function endpoints(
  registrars: Record<string, RegistrarEntry>,
  server: (entry: RegistrarEntry) => string | null,
  hostname: (server: string) => string,
  corpus: Map<string, string>
): Endpoint[] {
  const ids = new Map<string, string[]>();
  for (const [id, entry] of Object.entries(registrars)) {
    const key = server(entry);
    if (key) ids.set(key, [...(ids.get(key) ?? []), id]);
  }
  return [...ids.entries()]
    .map(([key, onIt]) => {
      const own = registrableDomain(hostname(key));
      const confirmed = onIt.map(id => registrars[id].domain).filter((d): d is string => !!d);
      const query =
        corpus.get(key) ?? confirmed.find(d => d === own) ?? confirmed[0] ?? own ?? 'example.com';
      return { key, query, ids: onIt };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}

// probe a set of endpoints, then once more the ones that failed, as the TLD sweeps do
async function sweep(
  list: Endpoint[],
  concurrency: number,
  probe: (endpoint: Endpoint) => Promise<Outcome>
): Promise<Map<string, Outcome>> {
  const outcomes = new Map<string, Outcome>();
  await runPool(list, concurrency, PACE_MS, async endpoint => {
    outcomes.set(endpoint.key, await probe(endpoint));
  });
  const retry = list.filter(e =>
    ['dead-candidate', 'suspect'].includes(outcomes.get(e.key)!.classification)
  );
  await runPool(retry, concurrency, PACE_MS, async endpoint => {
    outcomes.set(endpoint.key, await probe(endpoint));
  });
  return outcomes;
}

function tally(
  values: Iterable<ProbeClassification>
): Partial<Record<ProbeClassification, number>> {
  const counts: Partial<Record<ProbeClassification, number>> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

async function main(): Promise<void> {
  const started = Date.now();
  const limit = Number(getFlag('limit')) || undefined;
  const sample = Number(getFlag('sample')) || undefined;
  const dump = getFlag('dump');
  const noSave = process.argv.includes('--no-save');

  const { registrars } = loadRegistrars();
  const corpus = corpusQueries();
  const pick = (list: Endpoint[]): Endpoint[] => {
    const sampled = sample ? sampleN(list, sample) : list;
    return limit ? sampled.slice(0, limit) : sampled;
  };
  const whoisList = pick(
    endpoints(
      registrars,
      r => r.whois,
      host => host,
      corpus
    )
  );
  const rdapList = pick(
    endpoints(
      registrars,
      r => r.rdap,
      base => new URL(base).hostname,
      new Map()
    )
  );
  console.log(
    `probing ${whoisList.length} registrar WHOIS servers and ${rdapList.length} registrar RDAP bases...`
  );

  // the answers, for the parse measurement; the probe asks through this client
  const answers = new Map<string, string>();
  const client = toolingClient();
  const capturing = Object.assign(Object.create(client) as RdapWhois, {
    whois: async (...args: Parameters<RdapWhois['whois']>) => {
      const hops = await client.whois(...args);
      if (hops[0]?.raw && args[1]?.server) answers.set(args[1].server, hops[0].raw);
      return hops;
    },
  });

  const [whois, rdap] = await Promise.all([
    sweep(whoisList, WHOIS_CONCURRENCY, e =>
      probeWhoisServer(e.key, e.query, undefined, capturing)
    ),
    sweep(rdapList, RDAP_CONCURRENCY, e => probeRdapBase(e.key, `domain/${e.query}`)),
  ]);

  // fold into state: every accredited registrar, with its servers' outcomes
  const state = loadState();
  const previous = state.registrars ?? {};
  const fold = (
    list: Endpoint[],
    outcomes: Map<string, Outcome>,
    protocol: 'whois' | 'rdap'
  ): Record<string, ProbeRecord> => {
    const records: Record<string, ProbeRecord> = {};
    for (const [id, health] of Object.entries(previous)) {
      if (health[protocol]) records[id] = health[protocol];
    }
    for (const { key, query, ids } of list) {
      const outcome = outcomes.get(key)!;
      for (const id of ids) {
        recordProbe(records, id, {
          ...outcome,
          probeQuery: protocol === 'rdap' ? `domain/${query}` : query,
        });
      }
    }
    return records;
  };
  const whoisRecords = fold(whoisList, whois, 'whois');
  const rdapRecords = fold(rdapList, rdap, 'rdap');
  const health: Record<string, RegistrarHealth> = {};
  for (const [id, entry] of Object.entries(registrars)) {
    health[id] = {
      name: entry.name,
      ...(entry.whois && whoisRecords[id] && { whois: whoisRecords[id] }),
      ...(entry.rdap && rdapRecords[id] && { rdap: rdapRecords[id] }),
    };
  }
  state.registrars = health;

  // the parse measurement: servers that answered with a record, and those that parsed. An answer
  // with none of the record's fields is no record (a rate-limit or refusal notice the client did
  // not recognize, a notfound it missed), so it is listed apart rather than counted unparsed
  const score = (e: Endpoint): number => whois.get(e.key)!.score ?? 0;
  const healthyWhois = whoisList.filter(e => whois.get(e.key)!.classification === 'healthy');
  const noRecord = healthyWhois
    .filter(e => score(e) === 0)
    .map(e => ({
      host: e.key,
      registrars: e.ids.length,
      firstLine: (answers.get(e.key) ?? '').trim().split('\n')[0].slice(0, 120),
    }));
  const answered = healthyWhois.filter(e => score(e) > 0);
  const unparsed = answered
    .filter(e => score(e) < PARSED_MIN_SCORE)
    .map(e => ({ host: e.key, registrars: e.ids.length, score: score(e) }))
    .sort((a, b) => b.registrars - a.registrars || a.host.localeCompare(b.host));
  const entries = Object.values(health);
  const isHealthy = (record?: ProbeRecord): boolean => record?.classification === 'healthy';
  const report: RegistrarReport = {
    probedAt: new Date().toISOString(),
    coverage: coverage(registrars),
    healthy: {
      whois: entries.filter(h => isHealthy(h.whois)).length,
      rdap: entries.filter(h => isHealthy(h.rdap)).length,
      either: entries.filter(h => isHealthy(h.whois) || isHealthy(h.rdap)).length,
    },
    servers: {
      whois: tally([...whois.values()].map(o => o.classification)),
      rdap: tally([...rdap.values()].map(o => o.classification)),
    },
    parse: {
      minScore: PARSED_MIN_SCORE,
      answered: answered.length,
      parsed: answered.length - unparsed.length,
      registrarsAnswered: answered.reduce((n, e) => n + e.ids.length, 0),
      registrarsParsed:
        answered.reduce((n, e) => n + e.ids.length, 0) -
        unparsed.reduce((n, u) => n + u.registrars, 0),
      unparsed,
      noRecord,
    },
    elapsedSeconds: Math.round((Date.now() - started) / 1000),
  };

  if (dump) {
    mkdirSync(dump, { recursive: true });
    for (const { key, query, ids } of whoisList) {
      const raw = answers.get(key);
      if (raw) writeFileSync(`${dump}/${key}___${query}.txt`, raw);
      writeFileSync(
        `${dump}/${key}.json`,
        JSON.stringify({ query, ids, outcome: whois.get(key) }, null, 2)
      );
    }
  }

  if (noSave) {
    console.log('\n--no-save: state.json and the registrar report NOT written');
  } else {
    saveState(state);
    mkdirSync(HEALTH_DIR, { recursive: true });
    writeFileSync(REGISTRAR_REPORT_FILE, JSON.stringify(report, null, 2) + '\n', 'utf8');
  }
  persistThrottling('whois', whois, !noSave);
  persistThrottling('rdap', rdap, !noSave);

  const { coverage: c, healthy, parse } = report;
  console.log(
    `\n${c.accredited} accredited registrars: ${c.whois} WHOIS, ${c.rdap} RDAP, ${c.both} both, ${c.neither} neither`
  );
  console.log(`healthy: ${healthy.whois} WHOIS, ${healthy.rdap} RDAP, ${healthy.either} either`);
  console.log(`WHOIS servers: ${JSON.stringify(report.servers.whois)}`);
  console.log(`RDAP bases: ${JSON.stringify(report.servers.rdap)}`);
  console.log(
    `parsed: ${parse.parsed} of ${parse.answered} answering WHOIS servers (${parse.registrarsParsed} of ${parse.registrarsAnswered} registrars)`
  );
  console.log(`elapsed: ${report.elapsedSeconds}s`);
  process.exit(0);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
