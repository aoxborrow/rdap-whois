#!/usr/bin/env tsx
// Registry against registrar (docs/archive/whois-rdap-client.md, decision 16 / M0 measurements).
//
// For names whose registry refers to a registrar's RDAP server, fetch both hops and report
// where they disagree: creation date, expiry, status and nameservers. It also records how
// often the registrar hop fails outright, since today a lookup takes its whole answer from
// the last hop. The result decides which hop should win by default and whether the record
// needs any new field (a separate registrar expiry, for one).
//
// Names: the per-TLD samples in tranco-names.json, plus popular .com/.net/.org names from
// the Tranco sample for registrar variety, since most registrars are only reachable under
// those TLDs.
//
// Run: npm run rdap:hop-compare [--per-tld N] [--popular N]
//        [--concurrency N] [--name example.com]
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DOMAIN_QUERY_TYPE } from '../../src/common/constants';
import { getRdapServerFromCache } from '../../src/rdap/servers';
import { runPool } from '../registry-health/state';
import { fetchRdap } from './probe/rdap-probe';
import { HEALTH_DIR, PACKAGE_DIR } from '../lib/paths';

const DATA_DIR = `${PACKAGE_DIR}scripts/whois/data/`;
const REPORT_FILE = `${HEALTH_DIR}hop-compare.json`;
const DAY_MS = 24 * 60 * 60 * 1000;

function getFlag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}
const PER_TLD = Number(getFlag('per-tld') ?? 1);
const POPULAR = Number(getFlag('popular') ?? 200);
const CONCURRENCY = Number(getFlag('concurrency') ?? 8);
const ONLY_NAME = getFlag('name');

type Json = Record<string, unknown>;

// what one hop said, reduced to the fields being compared
interface Hop {
  url: string;
  status: number | null;
  error?: string;
  registration: string[];
  expiration: string[];
  registrarExpiration: string[];
  transfer: string[];
  eventActions: string[];
  statuses: string[];
  nameservers: string[];
}

interface Row {
  name: string;
  tld: string;
  registry: Hop | null;
  // why there is no registrar hop, when there is none
  referral: 'followed' | 'none' | 'not-rdap' | 'same-host' | 'registry-failed';
  registrar: Hop | null;
}

function eventDates(json: Json, action: string): string[] {
  const events = Array.isArray(json.events) ? (json.events as unknown[]) : [];
  return events
    .filter((e): e is Json => typeof e === 'object' && e !== null)
    .filter(e => e.eventAction === action && typeof e.eventDate === 'string')
    .map(e => e.eventDate as string);
}

function reduce(url: string, status: number, json: Json | null): Hop {
  const events = json && Array.isArray(json.events) ? (json.events as unknown[]) : [];
  const actions = new Set<string>();
  for (const e of events) {
    const action = (e as Json | null)?.eventAction;
    if (typeof action === 'string') actions.add(action);
  }
  const nameservers =
    json && Array.isArray(json.nameservers)
      ? (json.nameservers as unknown[])
          .map(ns => (ns as Json | null)?.ldhName)
          .filter((v): v is string => typeof v === 'string')
          .map(v => v.toLowerCase().replace(/\.$/, ''))
      : [];
  const statuses =
    json && Array.isArray(json.status)
      ? (json.status as unknown[])
          .filter((v): v is string => typeof v === 'string')
          .map(v => v.toLowerCase().replace(/\s+/g, ''))
      : [];
  return {
    url,
    status,
    registration: json ? eventDates(json, 'registration') : [],
    expiration: json ? eventDates(json, 'expiration') : [],
    registrarExpiration: json ? eventDates(json, 'registrar expiration') : [],
    transfer: json ? eventDates(json, 'transfer') : [],
    eventActions: [...actions].sort(),
    statuses: [...new Set(statuses)].sort(),
    nameservers: [...new Set(nameservers)].sort(),
  };
}

async function fetchHop(url: string): Promise<{ hop: Hop; json: Json | null }> {
  try {
    const { status, body } = await fetchRdap(url);
    let json: Json | null = null;
    try {
      const parsed = JSON.parse(body) as unknown;
      if (typeof parsed === 'object' && parsed !== null) json = parsed as Json;
    } catch {
      json = null;
    }
    // an RDAP error object carries no domain data
    const usable = status === 200 && json && typeof json.errorCode !== 'number' ? json : null;
    return { hop: reduce(url, status, usable), json: usable };
  } catch (error) {
    const hop = reduce(url, 0, null);
    hop.status = null;
    hop.error = error instanceof Error ? error.message : String(error);
    return { hop, json: null };
  }
}

// the registrar's RDAP URL for this name, from the registry response's `related` link —
// the same link today's referral loop follows
function referralUrl(json: Json, name: string): { url: string | null; why: Row['referral'] } {
  const links = Array.isArray(json.links) ? (json.links as unknown[]) : [];
  const related = links
    .filter((l): l is Json => typeof l === 'object' && l !== null)
    .find(l => l.rel === 'related');
  if (!related || typeof related.href !== 'string') return { url: null, why: 'none' };
  if (typeof related.type !== 'string' || !related.type.includes('rdap')) {
    return { url: null, why: 'not-rdap' };
  }
  let href = related.href.replace(/^http:\/\//i, 'https://');
  // some registries give the registrar's base URL rather than the object's URL
  if (!/\/domain\//i.test(href)) href = `${href.replace(/\/+$/, '')}/domain/${name}`;
  return { url: href, why: 'followed' };
}

async function compare(name: string): Promise<Row> {
  const tld = name.slice(name.lastIndexOf('.') + 1);
  const base = getRdapServerFromCache(DOMAIN_QUERY_TYPE, name);
  if (!base) return { name, tld, registry: null, referral: 'registry-failed', registrar: null };

  const registryUrl = `${base}domain/${name}`;
  const { hop: registry, json } = await fetchHop(registryUrl);
  if (!json) return { name, tld, registry, referral: 'registry-failed', registrar: null };

  const { url, why } = referralUrl(json, name);
  if (!url) return { name, tld, registry, referral: why, registrar: null };
  if (new URL(url).hostname === new URL(registryUrl).hostname) {
    return { name, tld, registry, referral: 'same-host', registrar: null };
  }
  const { hop: registrar } = await fetchHop(url);
  return { name, tld, registry, referral: 'followed', registrar };
}

const firstTime = (dates: string[]): number | null => {
  const t = Date.parse(dates[0] ?? '');
  return Number.isFinite(t) ? t : null;
};

function summarize(rows: Row[]): void {
  const withRegistry = rows.filter(
    r => r.registry?.status === 200 && r.referral !== 'registry-failed'
  );
  const followed = rows.filter(r => r.referral === 'followed' && r.registrar);
  const both = followed.filter(r => r.registrar?.status === 200 && r.registrar.eventActions.length);

  console.log(`\n=== registry against registrar: ${rows.length} names ===`);
  console.log(`  registry answered:           ${withRegistry.length}`);
  for (const why of ['none', 'not-rdap', 'same-host'] as const) {
    console.log(
      `  no registrar hop (${why}):`.padEnd(31) + rows.filter(r => r.referral === why).length
    );
  }
  console.log(`  referral followed:           ${followed.length}`);
  console.log(`    registrar answered:        ${both.length}`);
  console.log(
    `    registrar 404:             ${followed.filter(r => r.registrar?.status === 404).length}`
  );
  console.log(
    `    registrar other status:    ${followed.filter(r => r.registrar?.status && ![200, 404].includes(r.registrar.status)).length}`
  );
  console.log(
    `    registrar unreachable:     ${followed.filter(r => r.registrar?.status === null).length}`
  );
  console.log(
    `    registrar 200, no events:  ${followed.filter(r => r.registrar?.status === 200 && !r.registrar.eventActions.length).length}`
  );

  // creation
  let same = 0;
  let sameDay = 0;
  let later = 0;
  let earlier = 0;
  let missing = 0;
  const creationExamples: string[] = [];
  for (const row of both) {
    const a = firstTime(row.registry!.registration);
    const b = firstTime(row.registrar!.registration);
    if (a === null || b === null) {
      missing++;
      continue;
    }
    const diff = b - a;
    if (diff === 0) same++;
    else if (Math.abs(diff) <= DAY_MS) sameDay++;
    else {
      if (diff > 0) later++;
      else earlier++;
      creationExamples.push(
        `${row.name}: registry ${row.registry!.registration[0]} · registrar ${row.registrar!.registration[0]} (${Math.round(diff / DAY_MS)}d)`
      );
    }
  }
  console.log(`\n  creation date (both hops answered: ${both.length})`);
  console.log(`    identical:                 ${same}`);
  console.log(`    within a day:              ${sameDay}`);
  console.log(`    registrar LATER by >1d:    ${later}`);
  console.log(`    registrar EARLIER by >1d:  ${earlier}`);
  console.log(`    one side has none:         ${missing}`);
  creationExamples.slice(0, 25).forEach(e => console.log(`      ${e}`));

  // expiry
  let expSame = 0;
  let expDay = 0;
  let expDiffer = 0;
  let expMissing = 0;
  let registrarExpPresent = 0;
  let registrarExpDiffers = 0;
  const expiryExamples: string[] = [];
  for (const row of both) {
    const a = firstTime(row.registry!.expiration);
    const b = firstTime(row.registrar!.expiration);
    const c = firstTime(row.registrar!.registrarExpiration);
    if (c !== null) {
      registrarExpPresent++;
      if (a !== null && Math.abs(c - a) > DAY_MS) registrarExpDiffers++;
    }
    if (a === null || b === null) {
      expMissing++;
      continue;
    }
    const diff = b - a;
    if (diff === 0) expSame++;
    else if (Math.abs(diff) <= DAY_MS) expDay++;
    else {
      expDiffer++;
      expiryExamples.push(
        `${row.name}: registry ${row.registry!.expiration[0]} · registrar ${row.registrar!.expiration[0]} (${Math.round(diff / DAY_MS)}d)`
      );
    }
  }
  console.log(`\n  expiry: registry "expiration" against registrar "expiration"`);
  console.log(`    identical:                 ${expSame}`);
  console.log(`    within a day:              ${expDay}`);
  console.log(`    differ by >1d:             ${expDiffer}`);
  console.log(`    one side has none:         ${expMissing}`);
  expiryExamples.slice(0, 25).forEach(e => console.log(`      ${e}`));
  console.log(`\n  registrar hop has a "registrar expiration" event: ${registrarExpPresent}`);
  console.log(`    and it differs from the registry expiry by >1d: ${registrarExpDiffers}`);
  console.log(
    `  registry hop has a "registrar expiration" event:  ${withRegistry.filter(r => r.registry!.registrarExpiration.length).length}`
  );

  // status and nameservers
  const eq = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);
  const statusSame = both.filter(r => eq(r.registry!.statuses, r.registrar!.statuses)).length;
  const nsSame = both.filter(r => eq(r.registry!.nameservers, r.registrar!.nameservers)).length;
  const nsEmptyRegistrar = both.filter(
    r => r.registry!.nameservers.length && !r.registrar!.nameservers.length
  ).length;
  console.log(`\n  status set identical:        ${statusSame} of ${both.length}`);
  console.log(`  nameserver set identical:    ${nsSame} of ${both.length}`);
  console.log(`    registrar lists none:      ${nsEmptyRegistrar}`);

  // which event actions each side uses
  const tally = (hops: Hop[]) => {
    const counts = new Map<string, number>();
    for (const hop of hops)
      for (const a of hop.eventActions) counts.set(a, (counts.get(a) ?? 0) + 1);
    return [...counts].sort(([, a], [, b]) => b - a);
  };
  console.log(`\n  event actions, registry hops (${withRegistry.length}):`);
  tally(withRegistry.map(r => r.registry!)).forEach(([a, n]) =>
    console.log(`    ${`${a}:`.padEnd(32)} ${n}`)
  );
  console.log(`  event actions, registrar hops (${both.length}):`);
  tally(both.map(r => r.registrar!)).forEach(([a, n]) =>
    console.log(`    ${`${a}:`.padEnd(32)} ${n}`)
  );
}

async function main(): Promise<void> {
  const tranco = JSON.parse(readFileSync(`${DATA_DIR}tranco-names.json`, 'utf8')) as Record<
    string,
    string[]
  >;
  const names = new Set<string>();
  if (ONLY_NAME) {
    names.add(ONLY_NAME);
  } else {
    // registry-owned nic.<tld> names rarely have a registrar, so prefer anything else
    for (const list of Object.values(tranco)) {
      const preferred = list.filter(n => !n.startsWith('nic.'));
      (preferred.length ? preferred : list).slice(0, PER_TLD).forEach(n => names.add(n));
    }
    const popular = readFileSync(`${DATA_DIR}tranco-top-1m-sample.csv`, 'utf8')
      .split('\n')
      .map(line => line.split(',')[1]?.trim())
      .filter((n): n is string => !!n && /^[a-z0-9-]+\.(com|net|org)$/.test(n));
    popular.slice(0, POPULAR).forEach(n => names.add(n));
  }

  const list = [...names];
  console.log(`comparing ${list.length} names at concurrency ${CONCURRENCY}…`);
  const rows = new Array<Row>(list.length);
  let done = 0;
  await runPool(list, CONCURRENCY, 50, async (name, index) => {
    rows[index] = await compare(name);
    done++;
    if (done % 100 === 0) console.log(`  ${done}/${list.length}`);
  });

  summarize(rows);
  // one row per line: greppable, and half the size of an indented dump
  writeFileSync(
    REPORT_FILE,
    `{"checkedAt":${JSON.stringify(new Date().toISOString())},"rows":[\n` +
      rows.map(row => JSON.stringify(row)).join(',\n') +
      '\n]}\n',
    'utf8'
  );
  console.log(`\nreport: registry-health/hop-compare.json`);
  process.exit(0);
}

void main();
