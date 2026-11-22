#!/usr/bin/env tsx
// RDAP validation dry run (docs/archive/whois-rdap-client.md, decision 15 / M0 measurements).
//
// Applies the library's response checks to a live domain response from every RDAP server
// in the health state, and to recorded responses (--fixtures DIR), WITHOUT enforcing anything. The point
// is to see what the checks would reject or drop before deciding whether they are on by
// default: which servers answer about a different name, which omit the name, and which
// have a registration date that is missing, or that the checks would drop as unparseable,
// in the future or after the expiry.
//
// For each server it needs a registered name, so it tries a few well-known names for the
// TLD (tranco-names.json) and then nic.<tld>, and uses the first that returns a domain
// object.
//
// Run: npm run rdap:validate-dry-run [--sample N] [--base url]
//        [--concurrency N] [--offline] [--fixtures DIR]
//
// --fixtures reads a directory of recorded responses named <server>___<name>.json, each an
// RDAP response or an object with the response under `data`
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { parseRdapDate, validateRdapDomain } from '../../src/rdap/validate';
import { runPool, sampleN } from '../registry-health/state';
import { fetchRdap } from './probe/rdap-probe';
import { HEALTH_DIR, TRANCO_NAMES_FILE } from '../lib/paths';

const STATE_FILE = `${HEALTH_DIR}state.json`;
const TRANCO_FILE = TRANCO_NAMES_FILE;
const REPORT_FILE = `${HEALTH_DIR}rdap-validation.json`;

function getFlag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}
const SAMPLE = getFlag('sample');
const ONLY_BASE = getFlag('base');
const CONCURRENCY = Number(getFlag('concurrency') ?? 8);
const OFFLINE = process.argv.includes('--offline');
const FIXTURES_DIR = getFlag('fixtures')?.replace(/\/?$/, '/');
// how many names to try per server before giving up on finding a registered one
const MAX_CANDIDATES = 4;

interface Row {
  // the RDAP base URL, or the fixture file for offline rows
  server: string;
  tld: string;
  // the name whose response was checked, when one was found
  name: string | null;
  // 'checked' when a domain object was validated; otherwise why not
  outcome: 'checked' | 'no-sample' | 'error';
  detail?: string;
  nameCheck?: 'match' | 'mismatch' | 'missing';
  responseName?: string | null;
  // which of ldhName / unicodeName the response carried
  nameFields?: string[];
  // whether the response had a registration event at all
  hasRegistration?: boolean;
  // why the checks would drop the registration date, and the dates as the server sent them
  dropped?: { reason: 'unparseable' | 'future' | 'after-expiration'; values: string[] };
  // more than one distinct registration date, of which the earliest is kept
  ambiguous?: boolean;
  // every eventAction the response listed, for the registry-vs-registrar question
  eventActions?: string[];
}

function eventActions(response: Record<string, unknown>): string[] {
  const events = Array.isArray(response.events) ? (response.events as unknown[]) : [];
  const actions = new Set<string>();
  for (const event of events) {
    const action = (event as { eventAction?: unknown } | null)?.eventAction;
    if (typeof action === 'string') actions.add(action);
  }
  return [...actions].sort();
}

// why a registration date the checks dropped was dropped, by the rules validateRdapDomain
// applies
function dropReason(registrations: string[]): 'unparseable' | 'future' | 'after-expiration' {
  const times = registrations
    .map(value => parseRdapDate(value)?.getTime())
    .filter((time): time is number => time !== undefined);
  if (!times.length) return 'unparseable';
  return Math.min(...times) > Date.now() + 24 * 60 * 60 * 1000 ? 'future' : 'after-expiration';
}

function check(server: string, tld: string, name: string, response: Record<string, unknown>): Row {
  const result = validateRdapDomain(response, name);
  const registrations = ((Array.isArray(response.events) ? response.events : []) as unknown[])
    .map(event => event as { eventAction?: unknown; eventDate?: unknown } | null)
    .filter(event => event?.eventAction === 'registration' && typeof event.eventDate === 'string')
    .map(event => event?.eventDate as string);
  return {
    server,
    tld,
    name,
    outcome: 'checked',
    nameCheck: result.name,
    responseName: result.responseName,
    nameFields: ['ldhName', 'unicodeName'].filter(field => typeof response[field] === 'string'),
    hasRegistration: registrations.length > 0,
    ...(registrations.length && !result.creationDate
      ? { dropped: { reason: dropReason(registrations), values: registrations } }
      : {}),
    ambiguous: new Set(registrations.map(value => parseRdapDate(value)?.getTime())).size > 1,
    eventActions: eventActions(response),
  };
}

// find a registered name on this server and validate its response
async function probe(base: string, tld: string, names: string[]): Promise<Row> {
  const tried: string[] = [];
  // whether any candidate got an HTTP status back, as opposed to only thrown errors
  let answered = false;
  for (const name of names.slice(0, MAX_CANDIDATES)) {
    try {
      const { status, body } = await fetchRdap(`${base}domain/${name}`);
      answered = true;
      tried.push(`${name}:${status}`);
      if (status !== 200) continue;
      let json: unknown;
      try {
        json = JSON.parse(body) as unknown;
      } catch {
        continue;
      }
      if (typeof json !== 'object' || json === null) continue;
      const response = json as Record<string, unknown>;
      // an RDAP error object or a non-domain object is not a sample
      if (response.errorCode !== undefined || response.objectClassName !== 'domain') continue;
      return check(base, tld, name, response);
    } catch (error) {
      tried.push(`${name}:${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return {
    server: base,
    tld,
    name: null,
    outcome: answered ? 'no-sample' : 'error',
    detail: tried.join(', '),
  };
}

function offlineRows(): Row[] {
  const rows: Row[] = [];
  if (!FIXTURES_DIR || !existsSync(FIXTURES_DIR)) return rows;
  for (const file of readdirSync(FIXTURES_DIR).filter(f => f.endsWith('.json'))) {
    const base = file.slice(0, -'.json'.length);
    const sep = base.indexOf('___');
    if (sep < 0) continue;
    const name = base.slice(sep + 3);
    // a fixture is a recorded tool result; the RDAP response is its `data`
    const recorded = JSON.parse(readFileSync(FIXTURES_DIR + file, 'utf8')) as {
      data?: Record<string, unknown>;
    };
    const response = recorded.data ?? (recorded as Record<string, unknown>);
    if (response.objectClassName !== 'domain') continue;
    rows.push(check(`fixture:${file}`, name.split('.').pop() ?? '', name, response));
  }
  return rows;
}

function summarize(label: string, rows: Row[]): void {
  const checked = rows.filter(row => row.outcome === 'checked');
  const count = (test: (row: Row) => boolean) => checked.filter(test).length;

  console.log(
    `\n=== ${label}: ${rows.length} servers, ${checked.length} with a response to check ===`
  );
  console.log(`  no registered name found:  ${rows.filter(r => r.outcome === 'no-sample').length}`);
  console.log(`  unreachable:               ${rows.filter(r => r.outcome === 'error').length}`);
  console.log(`\n  name`);
  console.log(`    match:                   ${count(r => r.nameCheck === 'match')}`);
  console.log(`    MISMATCH (would reject): ${count(r => r.nameCheck === 'mismatch')}`);
  console.log(`    missing (no name given): ${count(r => r.nameCheck === 'missing')}`);
  console.log(`\n  registration date`);
  console.log(
    `    kept:                    ${count(r => r.hasRegistration === true && !r.dropped)}`
  );
  console.log(`    no registration event:   ${count(r => r.hasRegistration === false)}`);
  for (const reason of ['unparseable', 'future', 'after-expiration'] as const) {
    console.log(`    ${`${reason}:`.padEnd(24)} ${count(r => r.dropped?.reason === reason)}`);
  }
  console.log(`    ambiguous, earliest kept: ${count(r => r.ambiguous === true)}`);

  const actions = new Map<string, number>();
  for (const row of checked) {
    for (const action of row.eventActions ?? [])
      actions.set(action, (actions.get(action) ?? 0) + 1);
  }
  console.log(`\n  event actions seen (servers)`);
  for (const [action, n] of [...actions].sort(([, a], [, b]) => b - a)) {
    console.log(`    ${`${action}:`.padEnd(32)} ${n}`);
  }

  const flagged = checked.filter(
    r => r.nameCheck !== 'match' || Boolean(r.dropped) || r.ambiguous || r.hasRegistration === false
  );
  if (flagged.length) {
    console.log(`\n  flagged (${flagged.length}):`);
    for (const row of flagged.slice(0, 80)) {
      const parts = [
        row.nameCheck !== 'match'
          ? `name ${row.nameCheck} (got ${row.responseName ?? 'none'})`
          : '',
        row.dropped ? `${row.dropped.reason}=${JSON.stringify(row.dropped.values)}` : '',
        row.ambiguous ? 'ambiguous' : '',
        row.hasRegistration === false ? 'no registration event' : '',
      ].filter(Boolean);
      console.log(`    ${row.server}  ${row.name}  →  ${parts.join('; ')}`);
    }
    if (flagged.length > 80) console.log(`    …and ${flagged.length - 80} more`);
  }
}

async function main(): Promise<void> {
  const fixtureRows = offlineRows();
  summarize('recorded fixtures', fixtureRows);

  let liveRows: Row[] = [];
  if (!OFFLINE) {
    const state = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as {
      rdap: Record<string, { probeQuery: string | null }>;
    };
    const tranco = JSON.parse(readFileSync(TRANCO_FILE, 'utf8')) as Record<string, string[]>;

    // only the bases probed with a domain query serve domains
    let targets = Object.entries(state.rdap)
      .filter(([, entry]) => entry.probeQuery?.startsWith('domain/nic.'))
      .map(([base, entry]) => ({
        base,
        tld: (entry.probeQuery ?? '').slice('domain/nic.'.length),
      }))
      .filter(target => !ONLY_BASE || target.base === ONLY_BASE);
    if (SAMPLE) targets = sampleN(targets, Number(SAMPLE));

    console.log(`\nprobing ${targets.length} RDAP servers at concurrency ${CONCURRENCY}…`);
    liveRows = new Array<Row>(targets.length);
    let done = 0;
    await runPool(targets, CONCURRENCY, 50, async ({ base, tld }, index) => {
      const names = [...new Set([...(tranco[tld] ?? []), `nic.${tld}`])];
      liveRows[index] = await probe(base, tld, names);
      done++;
      if (done % 50 === 0) console.log(`  ${done}/${targets.length}`);
    });
    summarize('live RDAP servers', liveRows);
  }

  // an offline run has no live rows; do not overwrite a full report with an empty one
  if (!OFFLINE) {
    writeFileSync(
      REPORT_FILE,
      JSON.stringify(
        { checkedAt: new Date().toISOString(), fixtures: fixtureRows, live: liveRows },
        null,
        2
      ) + '\n',
      'utf8'
    );
    console.log(`\nreport: registry-health/rdap-validation.json`);
  }
  process.exit(0);
}

void main();
