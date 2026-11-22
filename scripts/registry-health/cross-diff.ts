#!/usr/bin/env tsx
// Cross-diff the three registry-truth sources and report who gained RDAP, who lost
// whois, and what moved — the discovery lane of docs/registry-health.md (M1):
//
//   static layers   data/whois/tlds-{ascii,extra,overrides}.json   (committed snapshot)
//   IANA sweep      data/whois/tlds-auto.json + registry-health/iana-sweep.json
//                   (refresh with `whois:update-tlds`)
//   RDAP bootstrap  data/rdap/dns.json (refresh with `rdap:update`)
//
// This also settles the old "need to verify null entries in tlds.json" TODO: every
// static null gets an IANA verdict (confirmed / gained a server / TLD retired).
//
// Reports only — nothing here changes routing data. Writes the machine-readable
// result to registry-health/cross-diff.json and prints a markdown summary.
// With --stealth, additionally probes rdap.org for whois-only TLDs (rdap.org knows
// servers not registered with IANA); pure signal, never auto-adopted.
//
// Run: npm run registry:cross-diff [--stealth]
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { normalizeServer } from '../../src/common/utils';
import { getRdapOrgRedirectUrl } from '../rdap/redirect';
import { mergeTldLayers } from '../whois/generate-tlds';
import { HEALTH_DIR, RDAP_DATA_DIR, WHOIS_DATA_DIR } from '../lib/paths';

const WHOIS_DIR = WHOIS_DATA_DIR;
const RDAP_DNS_FILE = `${RDAP_DATA_DIR}dns.json`;
const REPORT_DIR = HEALTH_DIR;
const REPORT_FILE = `${REPORT_DIR}cross-diff.json`;

const STEALTH_PACE_MS = 500;

type TldMap = Record<string, string | null>;

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

// a layer that may not exist yet (discovered/phaseout start absent)
function loadOptional(path: string): TldMap {
  return existsSync(path) ? loadJson<TldMap>(path) : {};
}

function list(label: string, items: string[], detail = Infinity): void {
  if (!items.length) return;
  const shown = items.slice(0, detail);
  const more = items.length - shown.length;
  console.log(
    `- ${label} (${items.length}): ${shown.join(', ')}${more > 0 ? ` (+${more} more)` : ''}`
  );
}

async function main(): Promise<void> {
  const ascii = loadJson<TldMap>(`${WHOIS_DIR}tlds-ascii.json`);
  const extra = loadJson<TldMap>(`${WHOIS_DIR}tlds-extra.json`);
  const overrides = loadJson<TldMap>(`${WHOIS_DIR}tlds-overrides.json`);
  const auto = loadJson<TldMap>(`${WHOIS_DIR}tlds-auto.json`);
  const discovered = loadOptional(`${WHOIS_DIR}tlds-discovered.json`);
  const phaseout = loadOptional(`${WHOIS_DIR}tlds-phaseout.json`);

  // static view = what routing looked like before the sweep layer
  const staticMap: TldMap = { ...ascii, ...extra, ...overrides };

  // IANA RDAP bootstrap: TLD → has RDAP
  const rdapBootstrap = loadJson<{ publication: string; services: string[][][] }>(RDAP_DNS_FILE);
  const rdapTlds = new Set<string>();
  for (const [tlds] of rdapBootstrap.services) {
    for (const tld of tlds) rdapTlds.add(tld.toLowerCase());
  }

  // ── sweep vs static ────────────────────────────────────────────────────────
  const moved: string[] = [];
  const gained: string[] = [];
  const ianaDropped: string[] = [];
  const overrideConflicts: string[] = [];
  for (const [tld, server] of Object.entries(auto)) {
    const staticServer = staticMap[tld];
    if (server && staticServer && server !== staticServer) {
      // hand overrides always win the merge — IANA disagreeing with one is worth
      // knowing (the override may be obsolete) but it is not a routing change
      if (tld in overrides) {
        overrideConflicts.push(`${tld} (override: ${staticServer}, IANA: ${server})`);
      } else {
        moved.push(`${tld} (${staticServer} → ${server})`);
      }
    } else if (server && !staticServer) {
      gained.push(`${tld} (${server})`);
    } else if (!server && staticServer && !(tld in overrides)) {
      // IANA no longer lists a whois server but the static layer has one — phase-out
      // CANDIDATES for the probe/decision lane (M2/M3), deliberately not auto-applied
      ianaDropped.push(`${tld} (static: ${staticServer})`);
    }
  }

  // static TLDs IANA doesn't know at all (retired TLDs; dotted pseudo-TLDs excluded)
  const retired = Object.keys(staticMap)
    .filter(tld => !tld.includes('.') && !(tld in auto))
    .sort();

  // ── null verification (settles the servers.ts "verify null entries" TODO) ──
  const staticNulls = Object.entries(staticMap)
    .filter(([tld, server]) => server === null && !tld.includes('.'))
    .map(([tld]) => tld);
  const nullsConfirmed = staticNulls.filter(tld => tld in auto && auto[tld] === null).sort();
  const nullsGained = staticNulls.filter(tld => auto[tld]).sort();
  const nullsRetired = staticNulls.filter(tld => !(tld in auto)).sort();

  // ── whois × RDAP coverage (post-merge view: what routing will look like) ───
  // The shared merge, so this really is what routing will look like. Hand-rolling it here
  // silently dropped the discovered + phaseout layers, which understated whois coverage:
  // a TLD whose static route died and was replaced by a probe-verified discovered server
  // counted as "no whois" and inflated the moat.
  const merged = mergeTldLayers();

  const topLevel = Object.keys(merged).filter(tld => !tld.includes('.'));
  const isCc = (tld: string) => tld.length === 2;
  const both: string[] = [];
  const whoisOnly: string[] = [];
  const rdapOnly: string[] = [];
  const neither: string[] = [];
  for (const tld of topLevel.sort()) {
    const hasWhois = Boolean(merged[tld]);
    const hasRdap = rdapTlds.has(tld);
    if (hasWhois && hasRdap) both.push(tld);
    else if (hasWhois) whoisOnly.push(tld);
    else if (hasRdap) rdapOnly.push(tld);
    else neither.push(tld);
  }
  const moatCc = whoisOnly.filter(isCc);

  // ── redundant overrides (hygiene) ─────────────────────────────────────────
  // An override whose value the LOWER layers already produce carries no decision — the
  // automation (auto sweep / discovered / phaseout) now covers it, so it can be dropped
  // from the owner-managed layer. This is "move stuff out of overrides once the normal
  // data produces it". Compare each override, normalized, against the shared merge minus
  // the overrides pass. Reported only — the job never edits the owner's overrides (that's
  // prune-overrides.ts, which reads the same base).
  const baseNoOverrides = mergeTldLayers({ includeOverrides: false });
  const normEq = (a: string | null, b: string | null): boolean =>
    (a == null ? null : normalizeServer(a)) === (b == null ? null : normalizeServer(b));
  const coveringLayer = (tld: string): string =>
    tld in phaseout
      ? 'phaseout'
      : tld in discovered
        ? 'discovered'
        : tld in auto && auto[tld] != null
          ? 'auto'
          : tld in extra
            ? 'extra'
            : 'ascii';
  const redundantOverrides = Object.keys(overrides)
    .filter(tld => normEq(overrides[tld], tld in baseNoOverrides ? baseNoOverrides[tld] : null))
    .sort()
    .map(tld => ({ tld, value: overrides[tld], coveredBy: coveringLayer(tld) }));

  console.log(`# Registry cross-diff (RDAP bootstrap publication: ${rdapBootstrap.publication})\n`);
  console.log(`## Sweep vs static snapshot`);
  list('server moved', moved);
  list('gained whois server', gained);
  list('override disagrees with IANA (override still wins)', overrideConflicts);
  list('IANA dropped whois (probe candidates, NOT auto-nulled)', ianaDropped, 15);
  list('TLD retired from IANA', retired);
  console.log(`\n## Static null verification (${staticNulls.length} nulls)`);
  console.log(`- confirmed no-whois by IANA: ${nullsConfirmed.length}`);
  list('actually have whois now', nullsGained);
  list('TLD retired from IANA', nullsRetired);
  console.log(`\n## whois × RDAP coverage (${topLevel.length} TLDs post-merge)`);
  console.log(`- both: ${both.length}`);
  console.log(`- whois only: ${whoisOnly.length} (${moatCc.length} ccTLDs — the moat)`);
  console.log(`- rdap only: ${rdapOnly.length}`);
  list('neither (no lookup possible!)', neither);

  console.log(`\n## Redundant overrides (${redundantOverrides.length})`);
  if (redundantOverrides.length) {
    console.log(
      `Lower layers now produce these exact values — safe to drop from tlds-overrides.json:`
    );
    for (const r of redundantOverrides) {
      console.log(`- ${r.tld} = ${r.value ?? 'null'} (already produced by ${r.coveredBy})`);
    }
  } else {
    console.log(`- none — every override still deviates from the automated layers`);
  }

  // ── optional: stealth-RDAP probe of the whois-only set via rdap.org ────────
  // Most of these TLDs genuinely lack RDAP, and rdap.org's no-redirect path is slow
  // (~8-12s) — so probes get a tight timeout (misses are acceptable, this is signal
  // only) and a small concurrent pool (per-call agents rotate egress IPs, so the
  // per-IP burst limit doesn't apply).
  const stealth: Record<string, string> = {};
  if (process.argv.includes('--stealth')) {
    console.log(`\n## Stealth RDAP probe (rdap.org, ${whoisOnly.length} whois-only TLDs)`);
    let probed = 0;
    let next = 0;
    await Promise.all(
      Array.from({ length: 3 }, async () => {
        while (next < whoisOnly.length) {
          const tld = whoisOnly[next++];
          const url = await getRdapOrgRedirectUrl('domain', `nic.${tld}`, 4000);
          if (url) {
            stealth[tld] = url.replace(/domain\/nic\..+$/, '');
            console.log(`- ${tld}: ${stealth[tld]}`);
          }
          probed++;
          if (probed % 50 === 0) console.log(`  (${probed}/${whoisOnly.length} probed)`);
          await new Promise(resolve => setTimeout(resolve, STEALTH_PACE_MS));
        }
      })
    );
    console.log(
      `- ${Object.keys(stealth).length} whois-only TLDs have RDAP servers rdap.org knows ` +
        '(signal only — IANA-unregistered RDAP is never auto-adopted)'
    );
  }

  mkdirSync(REPORT_DIR, { recursive: true });
  const report = {
    generatedAt: new Date().toISOString(),
    rdapPublication: rdapBootstrap.publication,
    sweep: { moved, gained, overrideConflicts, ianaDropped, retired },
    redundantOverrides,
    nulls: { confirmed: nullsConfirmed, gained: nullsGained, retired: nullsRetired },
    coverage: {
      both: both.length,
      whoisOnly,
      moatCc,
      rdapOnly,
      neither,
    },
    ...(Object.keys(stealth).length > 0 && { stealth }),
  };
  writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(`\nwrote ${REPORT_FILE}`);
  process.exit(0);
}

if (!existsSync(`${WHOIS_DIR}tlds-auto.json`)) {
  console.error('servers/tlds-auto.json missing — run `whois:update-tlds` first');
  process.exit(1);
}
main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
