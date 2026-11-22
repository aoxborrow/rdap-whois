#!/usr/bin/env tsx
// WHOIS registry against registrar (docs/archive/whois-rdap-client.md, decisions 14 and 16).
//
// The WHOIS counterpart of scripts/rdap/hop-compare.ts. For each name it queries the
// registry's WHOIS server, follows the registrar referral the way the whois tool does, and
// reports: how often the registrar hop answers at all, how much the parser gets out of a
// registrar's response (most registrar servers have no config of their own and fall back to
// the generic format), and where the two hops disagree on dates, status and nameservers.
//
// Names are deliberately ordinary. The RDAP run used the best-known name per TLD, which
// skews old and well kept. This one draws .com/.net/.org names from deep in a Tranco list
// and takes the deepest-ranked name per TLD elsewhere, with a fixed seed so a re-run picks
// the same names.
//
// Only parsed, non-contact fields are written to the report. Raw responses are not stored.
//
// Run: npm run whois:hop-compare --csv <tranco-full.csv>
//        [--count 300] [--concurrency 6] [--name example.com]
import { createReadStream, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { DOMAIN_QUERY_TYPE } from '../../src/common/constants';
import { EmptyResponseError, RateLimitError } from '../../src/index';
import { formatConfig } from '../../src/whois/formats';
import { toolingClient } from '../lib/client';
import { HEALTH_DIR, TRANCO_NAMES_FILE } from '../lib/paths';
import { goldenData } from './compare';
import { parseBlocks } from '../../src/whois/mapping';
import { getWhoisServer, parseReferralServer } from '../../src/whois/servers';
import { runPool } from '../registry-health/state';

const TRANCO_NAMES = TRANCO_NAMES_FILE;
const REPORT_FILE = `${HEALTH_DIR}whois-hop-compare.json`;
const DAY_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 10_000;
// .com/.net/.org names are drawn from below this Tranco rank, to avoid the famous ones
const MIN_RANK = 100_000;

function getFlag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}
const CSV = getFlag('csv');
const COUNT = Number(getFlag('count') ?? 300);
const CONCURRENCY = Number(getFlag('concurrency') ?? 6);
const ONLY_NAME = getFlag('name');

// small seeded generator so the sample is the same on every run
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pick<T>(items: T[], n: number, random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

type HopOutcome = 'found' | 'notfound' | 'throttled' | 'reserved' | 'servfail' | 'empty' | 'error';

// what one hop returned, reduced to what is compared. No contact data
interface Hop {
  server: string;
  // whether this server has its own parser config, or falls back to the generic format
  hasConfig: boolean;
  outcome: HopOutcome;
  error?: string;
  // how many fields the parser extracted, and whether the core ones are among them
  fields: number;
  hasName: boolean;
  creation: string | null;
  expiration: string | null;
  updated: string | null;
  registrar: string | null;
  reseller: string | null;
  status: string[];
  nameservers: string[];
  // which expiry label the raw response used
  expiryLabel: 'registry' | 'registrar' | 'both' | 'other' | 'none';
}

interface Row {
  name: string;
  tld: string;
  registry: Hop | null;
  referral: 'followed' | 'none' | 'same-server' | 'registry-failed' | 'no-server';
  registrar: Hop | null;
}

const options = { timeout: TIMEOUT_MS };
const client = toolingClient();

function expiryLabel(raw: string): Hop['expiryLabel'] {
  const registry = /Registry Expiry Date\s*:/i.test(raw);
  const registrar = /Registrar Registration Expiration Date\s*:/i.test(raw);
  if (registry && registrar) return 'both';
  if (registry) return 'registry';
  if (registrar) return 'registrar';
  return /expir|paid-till|renewal date|valid until/i.test(raw) ? 'other' : 'none';
}

async function queryHop(server: string, name: string): Promise<{ hop: Hop; raw: string | null }> {
  const blank: Hop = {
    server,
    hasConfig: !!formatConfig(server),
    outcome: 'error',
    fields: 0,
    hasName: false,
    creation: null,
    expiration: null,
    updated: null,
    registrar: null,
    reseller: null,
    status: [],
    nameservers: [],
    expiryLabel: 'none',
  };
  let raw: string;
  try {
    // one request to this server, no referral followed: the hops are compared here
    const [hop] = await client.whois(name, {
      server,
      queryType: DOMAIN_QUERY_TYPE,
      timeout: options.timeout,
      retries: 0,
      followReferrals: 0,
    });
    raw = hop?.raw ?? '';
  } catch (error) {
    // the library throws on a throttle page and on an empty body; the report counts both
    // as outcomes of their own, as it did when the raw text came back
    if (error instanceof RateLimitError && error.raw) {
      raw = error.raw;
    } else if (error instanceof EmptyResponseError) {
      return { hop: { ...blank, outcome: 'empty' }, raw: null };
    } else {
      return {
        hop: { ...blank, error: error instanceof Error ? error.name : String(error) },
        raw: null,
      };
    }
  }
  if (!raw.trim()) return { hop: { ...blank, outcome: 'empty' }, raw: null };

  const { data, status } = parseBlocks(raw, server, DOMAIN_QUERY_TYPE);
  // dates as text, so the two hops compare as the strings the report stores
  const bag = goldenData(data as unknown as Record<string, unknown>);
  const text = (key: string): string | null =>
    typeof bag[key] === 'string' && bag[key] ? (bag[key] as string) : null;
  const list = (key: string): string[] =>
    Array.isArray(bag[key])
      ? (bag[key] as unknown[])
          .filter((v): v is string => typeof v === 'string')
          .map(v => v.toLowerCase())
          .sort()
      : [];
  const fields = Object.entries(bag).filter(
    ([key, value]) =>
      !key.startsWith('__') &&
      value !== null &&
      value !== undefined &&
      value !== '' &&
      !(Array.isArray(value) && value.length === 0)
  ).length;

  const outcome: HopOutcome = status === 'error' ? 'servfail' : status;

  return {
    hop: {
      ...blank,
      outcome,
      fields,
      hasName: !!text('domainName'),
      creation: text('creationDate'),
      expiration: text('expirationDate'),
      updated: text('updatedDate'),
      registrar: text('registrarName'),
      reseller: text('registrarReseller'),
      status: list('eppStatus'),
      nameservers: list('nameservers'),
      expiryLabel: expiryLabel(raw),
    },
    raw,
  };
}

async function compare(name: string): Promise<Row> {
  const tld = name.slice(name.lastIndexOf('.') + 1);
  const server = getWhoisServer(DOMAIN_QUERY_TYPE, name);
  if (!server) return { name, tld, registry: null, referral: 'no-server', registrar: null };

  const { hop: registry, raw } = await queryHop(server, name);
  if (!raw || registry.outcome !== 'found') {
    return { name, tld, registry, referral: 'registry-failed', registrar: null };
  }
  // the same referral the whois tool follows
  const referral = parseReferralServer(raw);
  if (!referral) return { name, tld, registry, referral: 'none', registrar: null };
  if (referral === registry.server) {
    return { name, tld, registry, referral: 'same-server', registrar: null };
  }
  const { hop: registrar } = await queryHop(referral, name);
  return { name, tld, registry, referral: 'followed', registrar };
}

const time = (value: string | null): number | null => {
  const t = Date.parse(value ?? '');
  return Number.isFinite(t) ? t : null;
};
const same = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

function dateTable(label: string, rows: Row[], field: 'creation' | 'expiration' | 'updated'): void {
  let identical = 0;
  let withinDay = 0;
  let later = 0;
  let earlier = 0;
  let registryOnly = 0;
  let registrarOnly = 0;
  let neither = 0;
  const examples: string[] = [];
  for (const row of rows) {
    const a = time(row.registry![field]);
    const b = time(row.registrar![field]);
    if (a === null && b === null) neither++;
    else if (b === null) registryOnly++;
    else if (a === null) registrarOnly++;
    else if (a === b) identical++;
    else if (Math.abs(b - a) <= DAY_MS) withinDay++;
    else {
      if (b > a) later++;
      else earlier++;
      examples.push(
        `${row.name}: registry ${row.registry![field]} · registrar ${row.registrar![field]} (${Math.round((b - a) / DAY_MS)}d) [${row.registrar!.server}]`
      );
    }
  }
  console.log(`\n  ${label}`);
  console.log(`    identical:                 ${identical}`);
  console.log(`    within a day:              ${withinDay}`);
  console.log(`    registrar LATER by >1d:    ${later}`);
  console.log(`    registrar EARLIER by >1d:  ${earlier}`);
  console.log(`    only the registry has it:  ${registryOnly}`);
  console.log(`    only the registrar has it: ${registrarOnly}`);
  console.log(`    neither has it:            ${neither}`);
  examples.slice(0, 30).forEach(e => console.log(`      ${e}`));
}

function summarize(rows: Row[]): void {
  const count = (test: (row: Row) => boolean) => rows.filter(test).length;
  const followed = rows.filter(r => r.referral === 'followed' && r.registrar);
  const answered = followed.filter(r => r.registrar!.outcome === 'found');
  // "useful" = the parser got the name and at least one date out of the registrar's response
  const useful = answered.filter(
    r => r.registrar!.hasName && (r.registrar!.creation || r.registrar!.expiration)
  );

  console.log(`\n=== WHOIS registry against registrar: ${rows.length} names ===`);
  console.log(`  no WHOIS server:             ${count(r => r.referral === 'no-server')}`);
  console.log(`  registry did not answer:     ${count(r => r.referral === 'registry-failed')}`);
  const failed = rows.filter(r => r.referral === 'registry-failed' && r.registry);
  const outcomes = new Map<string, number>();
  for (const row of failed) {
    const key =
      row.registry!.outcome === 'error' ? `error ${row.registry!.error}` : row.registry!.outcome;
    outcomes.set(key, (outcomes.get(key) ?? 0) + 1);
  }
  [...outcomes].forEach(([k, n]) => console.log(`      ${k}: ${n}`));
  console.log(`  registry gave no referral:   ${count(r => r.referral === 'none')}`);
  console.log(`  referral to itself:          ${count(r => r.referral === 'same-server')}`);
  console.log(`  referral followed:           ${followed.length}`);

  console.log(`\n  registrar hop (${followed.length})`);
  for (const outcome of [
    'found',
    'notfound',
    'throttled',
    'servfail',
    'reserved',
    'empty',
    'error',
  ] as const) {
    const n = followed.filter(r => r.registrar!.outcome === outcome).length;
    if (n) console.log(`    ${`${outcome}:`.padEnd(26)} ${n}`);
  }
  const errors = new Map<string, number>();
  for (const row of followed.filter(r => r.registrar!.outcome === 'error')) {
    errors.set(row.registrar!.error ?? '?', (errors.get(row.registrar!.error ?? '?') ?? 0) + 1);
  }
  [...errors].forEach(([k, n]) => console.log(`      ${k}: ${n}`));

  console.log(`\n  what the parser got from a registrar that answered (${answered.length})`);
  console.log(`    name and a date:           ${useful.length}`);
  console.log(
    `    name, no date:             ${answered.filter(r => r.registrar!.hasName && !r.registrar!.creation && !r.registrar!.expiration).length}`
  );
  console.log(
    `    no name at all:            ${answered.filter(r => !r.registrar!.hasName).length}`
  );
  console.log(
    `    nothing (0 fields):        ${answered.filter(r => r.registrar!.fields === 0).length}`
  );
  console.log(
    `    server has its own config: ${answered.filter(r => r.registrar!.hasConfig).length}`
  );
  const fieldCounts = answered.map(r => r.registrar!.fields).sort((a, b) => a - b);
  if (fieldCounts.length) {
    console.log(
      `    fields parsed, median:     ${fieldCounts[Math.floor(fieldCounts.length / 2)]} (registry median ${
        answered.map(r => r.registry!.fields).sort((a, b) => a - b)[Math.floor(answered.length / 2)]
      })`
    );
  }
  const unparsed = answered.filter(r => !useful.includes(r));
  if (unparsed.length) {
    console.log(`    registrars we got little from:`);
    const hosts = new Map<string, number>();
    for (const row of unparsed)
      hosts.set(row.registrar!.server, (hosts.get(row.registrar!.server) ?? 0) + 1);
    [...hosts]
      .sort(([, a], [, b]) => b - a)
      .slice(0, 25)
      .forEach(([h, n]) => console.log(`      ${h}: ${n}`));
  }

  dateTable(`creation date (both parsed: of ${useful.length})`, useful, 'creation');
  dateTable(`expiry date`, useful, 'expiration');
  dateTable(`updated date`, useful, 'updated');

  const labels = new Map<string, number>();
  for (const row of answered)
    labels.set(row.registrar!.expiryLabel, (labels.get(row.registrar!.expiryLabel) ?? 0) + 1);
  console.log(`\n  expiry label in the registrar's raw response:`);
  [...labels]
    .sort(([, a], [, b]) => b - a)
    .forEach(([k, n]) => console.log(`    ${`${k}:`.padEnd(12)} ${n}`));

  console.log(
    `\n  status set identical:        ${useful.filter(r => same(r.registry!.status, r.registrar!.status)).length} of ${useful.length}`
  );
  console.log(
    `    registrar gave no status:  ${useful.filter(r => r.registry!.status.length && !r.registrar!.status.length).length}`
  );
  console.log(
    `  nameserver set identical:    ${useful.filter(r => same(r.registry!.nameservers, r.registrar!.nameservers)).length} of ${useful.length}`
  );
  console.log(
    `    registrar gave none:       ${useful.filter(r => r.registry!.nameservers.length && !r.registrar!.nameservers.length).length}`
  );
  console.log(`  reseller parsed (registry):  ${rows.filter(r => r.registry?.reseller).length}`);
  console.log(
    `  reseller parsed (registrar): ${answered.filter(r => r.registrar!.reseller).length}`
  );
  console.log(
    `  registrar hosts seen:        ${new Set(followed.map(r => r.registrar!.server)).size}`
  );
}

async function sampleNames(): Promise<string[]> {
  if (ONLY_NAME) return [ONLY_NAME];
  const random = seeded(20261109);
  const tranco = JSON.parse(readFileSync(TRANCO_NAMES, 'utf8')) as Record<string, string[]>;

  // elsewhere: the deepest-ranked name per TLD that is not the registry's own
  const deepest = (tld: string): string | undefined =>
    [...(tranco[tld] ?? [])].reverse().find(n => !n.startsWith('nic.'));
  const others = Object.keys(tranco).filter(tld => !['com', 'net', 'org'].includes(tld));
  const gtlds = others.filter(tld => !tld.includes('.') && tld.length > 2);
  const cctlds = others.filter(tld => tld.length === 2);

  const legacyCount = Math.round(COUNT * 0.4);
  const cctldCount = Math.round(COUNT * 0.1);
  const gtldCount = COUNT - legacyCount - cctldCount;

  // .com/.net/.org: from deep in the full list when one is given, else the stratified pool
  let legacy: string[];
  if (CSV) {
    const pool: string[] = [];
    const rl = createInterface({ input: createReadStream(CSV), crlfDelay: Infinity });
    for await (const line of rl) {
      const comma = line.indexOf(',');
      const rank = Number(line.slice(0, comma));
      const name = line.slice(comma + 1).trim();
      if (rank >= MIN_RANK && /^[a-z0-9-]+\.(com|net|org)$/.test(name)) pool.push(name);
    }
    legacy = pick(pool, legacyCount, random);
  } else {
    const pool = ['com', 'net', 'org'].flatMap(tld => (tranco[tld] ?? []).slice(10));
    legacy = pick(pool, legacyCount, random);
  }

  const names = new Set<string>(legacy);
  for (const tld of pick(gtlds, gtlds.length, random)) {
    if (names.size >= legacyCount + gtldCount) break;
    const name = deepest(tld);
    if (name) names.add(name);
  }
  for (const tld of pick(cctlds, cctlds.length, random)) {
    if (names.size >= COUNT) break;
    const name = deepest(tld);
    if (name) names.add(name);
  }
  return [...names];
}

async function main(): Promise<void> {
  const names = await sampleNames();
  console.log(`comparing ${names.length} names at concurrency ${CONCURRENCY}…`);
  const rows = new Array<Row>(names.length);
  let done = 0;
  await runPool(names, CONCURRENCY, 150, async (name, index) => {
    rows[index] = await compare(name);
    done++;
    if (done % 50 === 0) console.log(`  ${done}/${names.length}`);
  });

  summarize(rows);
  if (!ONLY_NAME) {
    writeFileSync(
      REPORT_FILE,
      `{"checkedAt":${JSON.stringify(new Date().toISOString())},"rows":[\n` +
        rows.map(row => JSON.stringify(row)).join(',\n') +
        '\n]}\n',
      'utf8'
    );
    console.log(`\nreport: registry-health/whois-hop-compare.json`);
  }
  process.exit(0);
}

void main();
