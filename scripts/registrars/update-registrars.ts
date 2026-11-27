#!/usr/bin/env tsx
// `npm run registrars:update` — rebuild the registrar server list
// (registry-health/registrars.json) from the IANA registrar-ids registry and the evidence that
// matches WHOIS servers to registrars (scripts/registrars/registrars.ts):
//
//   1. the accredited registrars and their RDAP bases, from IANA
//   2. the evidence the fixture corpus holds
//   3. live, unless --offline: Verisign's answer for the domain of every registrar server we
//      know under .com and .net (the thin registry names the sponsor's IANA ID and WHOIS
//      server), then each already-known registrar WHOIS server still matched to no registrar,
//      asked for its own domain
//
// A registrar whose WHOIS server or RDAP base changes loses that server's probe history in
// state.json, so its failure counter starts again on the new one.
//
// Run: npm run registrars:update [--offline] [--no-save]
import { deadDaysSince, PHASEOUT_MIN_AGE_DAYS, PHASEOUT_MIN_FAILURES } from '../whois/decide';
import { getTldServers } from '../whois/generate-tlds';
import { toolingClient, TOOLING_USER_AGENT } from '../lib/client';
import { loadState, runPool, saveState } from '../registry-health/state';
import { registrableDomain } from '../../src/registrable';
import {
  buildRegistrars,
  coverage,
  evidenceFrom,
  fixtureEvidence,
  IANA_REGISTRAR_IDS_URL,
  loadRegistrars,
  parseIanaRegistrars,
  saveRegistrars,
  seedHosts,
  type Evidence,
} from './registrars';

const VERISIGN = 'whois.verisign-grs.com';
const CONCURRENCY = 6;
const PACE_MS = 150;
const TIMEOUT_MS = 10000;

const offline = process.argv.includes('--offline');
const noSave = process.argv.includes('--no-save');

const client = toolingClient();

// one answer from one server, no referral and no retry; null when there was none
async function ask(server: string, domain: string): Promise<string | null> {
  try {
    const [hop] = await client.whois(domain, {
      server,
      followReferrals: 0,
      retries: 0,
      timeout: TIMEOUT_MS,
      totalTimeout: TIMEOUT_MS * 2,
    });
    return hop?.status === 'found' ? hop.raw : null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const started = Date.now();
  const response = await fetch(IANA_REGISTRAR_IDS_URL, {
    headers: { 'User-Agent': TOOLING_USER_AGENT },
  });
  if (!response.ok) throw new Error(`${IANA_REGISTRAR_IDS_URL}: HTTP ${response.status}`);
  const iana = parseIanaRegistrars(await response.text());
  const accredited = iana.registrars.filter(r => r.status === 'Accredited');
  console.log(`IANA registrar-ids (${iana.updated}): ${accredited.length} accredited`);

  const registryServers = new Set(
    Object.values(getTldServers()).filter((s): s is string => Boolean(s))
  );
  const seeds = seedHosts();
  const registrarServers = new Set(seeds);
  const evidence: Evidence[] = fixtureEvidence(registryServers, registrarServers);
  console.log(`fixture corpus: ${evidence.length} answers naming a registrar`);

  const previous = loadRegistrars();

  if (!offline) {
    // every registrar server's domain under .com/.net, asked of the thin registry
    const hosts = new Set<string>([
      ...seeds,
      ...evidence.map(e => e.host).filter((h): h is string => Boolean(h)),
      ...Object.values(previous.registrars).flatMap(r => (r.whois ? [r.whois] : [])),
      ...accredited.flatMap(r => (r.rdap ? [new URL(r.rdap).hostname] : [])),
    ]);
    const domains = [
      ...new Set([...hosts].map(registrableDomain).filter((d): d is string => Boolean(d))),
    ]
      .filter(d => /\.(com|net)$/.test(d))
      .sort();
    console.log(`asking ${VERISIGN} for ${domains.length} registrar domains...`);
    let learned = 0;
    await runPool(domains, CONCURRENCY, PACE_MS, async domain => {
      const raw = await ask(VERISIGN, domain);
      const found =
        raw && evidenceFrom(VERISIGN, domain, raw, registryServers, registrarServers, true);
      if (found) {
        evidence.push(found);
        learned++;
      }
    });
    console.log(`  ${learned} answers named a registrar`);

    // the known registrar servers nothing has matched yet, asked for their own domain
    const matched = new Set(evidence.map(e => e.host));
    const unmatched = seeds.filter(h => !matched.has(h) && registrableDomain(h));
    console.log(`asking ${unmatched.length} unmatched registrar servers for their own domain...`);
    let named = 0;
    await runPool(unmatched, CONCURRENCY, PACE_MS, async host => {
      const domain = registrableDomain(host)!;
      const raw = await ask(host, domain);
      const found = raw && evidenceFrom(host, domain, raw, registryServers, registrarServers, true);
      if (found) {
        evidence.push(found);
        named++;
      }
    });
    console.log(`  ${named} named their registrar`);
  }

  // a server is retired when it has gone without a proper answer for as many runs and days as
  // the TLD phase-out gate asks for, and its latest probe could not connect at all. A server
  // that still answers, even with a refusal, is never retired: the probe domain may be one its
  // registrars no longer sponsor. A retired server stays in the list's `retired` until live
  // evidence picks it again
  const state = loadState();
  const now = new Date();
  const retired = new Set([
    ...previous.retired,
    ...Object.entries(state.registrars ?? {}).flatMap(([id, health]) => {
      const host = previous.registrars[id]?.whois;
      const record = health.whois;
      return host &&
        record &&
        record.classification === 'dead-candidate' &&
        record.consecutiveFailures >= PHASEOUT_MIN_FAILURES &&
        deadDaysSince(record, now) >= PHASEOUT_MIN_AGE_DAYS
        ? [host]
        : [];
    }),
  ]);
  const registrars = buildRegistrars(iana.registrars, evidence, previous.registrars, retired);
  const chosen = new Set(Object.values(registrars).map(r => r.whois));
  const stillRetired = [...retired].filter(host => !chosen.has(host));
  const stats = coverage(registrars);
  const evidenced = new Set(evidence.map(e => e.host));
  const unmappedSeeds = seeds.filter(h => !chosen.has(h));
  const unknownSeeds = unmappedSeeds.filter(h => !evidenced.has(h));

  console.log(
    `\n${stats.accredited} accredited registrars: ${stats.whois} with a WHOIS server, ${stats.rdap} with an RDAP base, ${stats.both} both, ${stats.neither} neither`
  );
  console.log(
    `${stats.whoisServers} distinct WHOIS servers, ${stats.rdapBases} distinct RDAP bases; ${Object.values(registrars).filter(r => r.domain).length} registrars with a confirmed domain`
  );
  console.log(
    `known registrar WHOIS servers that are no registrar's server (${unmappedSeeds.length}): ${unmappedSeeds.length - unknownSeeds.length} lost to another server of the same registrar, ${unknownSeeds.length} matched to none: ${unknownSeeds.join(', ')}`
  );

  if (noSave) {
    console.log('\n--no-save: registry-health/registrars.json NOT written');
  } else {
    // a changed server starts a fresh probe history
    for (const [id, health] of Object.entries(state.registrars ?? {})) {
      const before = previous.registrars[id];
      const now = registrars[id];
      if (!now) continue;
      if (health.whois && before?.whois !== now.whois) delete health.whois;
      if (health.rdap && before?.rdap !== now.rdap) delete health.rdap;
    }
    saveState(state);
    saveRegistrars({ ...previous, updated: iana.updated, registrars, retired: stillRetired });
    console.log('\nwrote registry-health/registrars.json');
  }
  console.log(`elapsed: ${Math.round((Date.now() - started) / 1000)}s`);
  process.exit(0);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
