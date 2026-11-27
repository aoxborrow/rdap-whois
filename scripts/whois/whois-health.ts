#!/usr/bin/env tsx
// `npm run whois:health` — the whois lane of the registry-health pipeline
// (docs/registry-health.md §10.1). Runs: IANA TLD sweep → cross-diff → probe our whois
// servers → decide → regenerate the committed map → offline parser regression → report.
//
// The decision engine consumes the COMMITTED rdap state (bootstrap + the probe lane in
// registry-health/state.json) as an input — this lane never probes RDAP itself.
// That is why the wrapper (registry-health.ts) runs `rdap:health` FIRST: the whois
// decision reads the rdap lane's latest committed verdict (a healthy RDAP route is what
// lets a dead whois server be phased out — §10.2).
//
// Data changes land in the working tree; locally the owner reviews `git diff` and
// commits, on CI (M5) the same output becomes an auto-PR. Flags let you iterate on one
// part without re-running the network:
//
//   --skip-refresh   don't re-run the IANA sweep / cross-diff
//   --skip-probes    don't re-probe whois servers (decide over the existing state.json)
//   --decide-only    skip both network stages (= --skip-refresh --skip-probes)
//   --full-sweep     reserved pass-through (probes already do all servers)
//   --discover       after deciding, run whois:discover over the problem set (§10.4)
//   --sample N       probe a random N-of-all sample of servers (light CI sweep)
//   --limit N        probe the first N servers (alphabetical)
//   --report-only    decide + report but write NOTHING to the tree: no phase-out file,
//                    no override prune, no map regenerate, no state.json (forwards
//                    --no-save). The light weekly CI run — probes are a liveness
//                    spot-check; decide/parser run over COMMITTED state as a standing
//                    report. Nothing to commit, so CI never opens a PR.
//
// Exit code is red (non-zero) only on an actionable regression: a moat outage (a dead
// whois server for a TLD with no working RDAP fallback) or a top-100 parser regression.
// Plain data drift is green — the report + working-tree diff are the deliverable.
import { execSync } from 'node:child_process';
import { packageScript } from '../lib/run';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { DnsServerCache } from '../../src/rdap/cache/dns';
import { getTldServers } from './generate-tlds';
import {
  countCcMoatOutages,
  decide,
  mergePhaseout,
  MOAT_RED_AGE_DAYS,
  PHASEOUT_MIN_AGE_DAYS,
  PHASEOUT_MIN_FAILURES,
  type Decisions,
} from './decide';
import { HEALTH_DIR, PACKAGE_DIR, WHOIS_DATA_DIR } from '../lib/paths';
import { pruneOverrides } from './prune-overrides';
import { loadState, type HealthState } from '../registry-health/state';
import { loadThrottling } from '../registry-health/throttling';
import { renderRegistrarSection } from '../registrars/report';

const WHOIS_DIR = WHOIS_DATA_DIR;
const PHASEOUT_FILE = `${WHOIS_DIR}tlds-phaseout.json`;
const REPORT_JSON = `${HEALTH_DIR}decisions.json`;
const REPORT_MD = `${HEALTH_DIR}report.md`;

const flags = new Set(process.argv.slice(2).filter(a => a.startsWith('--')));
const skipRefresh = flags.has('--skip-refresh') || flags.has('--decide-only');
const skipProbes = flags.has('--skip-probes') || flags.has('--decide-only');
const discover = flags.has('--discover');
const reportOnly = flags.has('--report-only');

function flagValue(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : undefined;
}

// forward the sampling / no-save knobs to the probe sub-command
const probeArgs = [
  flagValue('sample') ? `--sample ${flagValue('sample')}` : '',
  flagValue('limit') ? `--limit ${flagValue('limit')}` : '',
  reportOnly || flags.has('--no-save') ? '--no-save' : '',
]
  .filter(Boolean)
  .join(' ');

function run(label: string, command: string): void {
  console.log(`\n=== ${label} ===`);
  execSync(command, { cwd: PACKAGE_DIR, stdio: 'inherit' });
}

function loadJson<T>(path: string, fallback: T): T {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : fallback;
}

// Build the two RDAP inputs the decision engine needs, entirely from the COMMITTED rdap
// state (§10.1: the whois lane never probes RDAP itself):
//   - rdapListedTlds:  every TLD with a route in the merged DnsServerCache — the same
//     bootstrap ← discovered ← overrides map the RDAP tool routes by (§10.4). A whois
//     server with no entry here is the whois-only moat.
//   - rdapHealthyTlds: those whose routed base URL last probed `healthy` in state.rdap —
//     §10.2's probe-verified "working RDAP route". `check-rdap` records state keyed by
//     the same normalizeRdapServer() form the cache routes by, so the keys line up.
function loadRdapRouteSets(rdapState: HealthState['rdap']): {
  rdapListedTlds: Set<string>;
  rdapHealthyTlds: Set<string>;
} {
  const cache = new DnsServerCache();
  const rdapListedTlds = new Set<string>();
  const rdapHealthyTlds = new Set<string>();
  for (const [tld, base] of cache.entries()) {
    const key = tld.toLowerCase();
    rdapListedTlds.add(key);
    if (rdapState[base]?.classification === 'healthy') rdapHealthyTlds.add(key);
  }
  return { rdapListedTlds, rdapHealthyTlds };
}

// IANA sweep: tld → whether IANA currently lists a whois server (from update-tlds)
function loadIanaListsServer(): Record<string, boolean> {
  const sweep = loadJson<{ entries: Record<string, { server: string | null }> }>(
    `${HEALTH_DIR}iana-sweep.json`,
    { entries: {} }
  );
  const map: Record<string, boolean> = {};
  for (const [tld, entry] of Object.entries(sweep.entries)) {
    map[tld] = entry.server !== null;
  }
  return map;
}

function renderReport(
  decisions: Decisions,
  whoisState: HealthState['whois'],
  knownMoatOutages: Set<string>
): string {
  const probed = Object.keys(whoisState).length;
  const dead = Object.values(whoisState).filter(r => r.classification === 'dead-candidate').length;
  const refused = Object.values(whoisState).filter(r => r.classification === 'refused').length;
  const lines: string[] = [];
  lines.push(`# Registry health report (whois lane)`);
  lines.push('');
  lines.push(
    `Probed ${probed} whois servers; ${dead} dead-candidate, ${refused} refused (an error page instead of a record).`
  );
  lines.push('');

  if (decisions.moatOutages.length) {
    const cc = countCcMoatOutages(decisions.moatOutages);
    const fresh = decisions.moatOutages.filter(m => !knownMoatOutages.has(m.tld)).length;
    lines.push(
      decisions.red
        ? `## 🔴 Moat outages (${decisions.moatOutages.length}, ${cc} ccTLD, ${fresh} new) — build RED`
        : `## 🟠 Moat outages (${decisions.moatOutages.length}, ${cc} ccTLD, none new)`
    );
    lines.push('');
    lines.push(
      `Dead whois with NO RDAP fallback (down ≥${MOAT_RED_AGE_DAYS}d) — these TLDs are unlookupable. Never auto-nulled. Only an outage the last committed report did not list turns the build red.`
    );
    lines.push('');
    for (const m of decisions.moatOutages) {
      lines.push(
        `- **${m.tld}** → ${m.server} (dead ${m.deadDays}d, ×${m.consecutiveFailures})${knownMoatOutages.has(m.tld) ? '' : ' — new'}${m.detail ? ` — ${m.detail}` : ''}`
      );
    }
    lines.push('');
  }

  if (decisions.moatWatch.length) {
    const cc = countCcMoatOutages(decisions.moatWatch);
    lines.push(`## 🟡 Moat watch (${decisions.moatWatch.length}, ${cc} ccTLD)`);
    lines.push('');
    lines.push(
      `Dead whois with NO RDAP, down <${MOAT_RED_AGE_DAYS}d — red if they persist. Never nulled.`
    );
    lines.push('');
    for (const m of decisions.moatWatch) {
      lines.push(
        `- ${m.tld} → ${m.server} (dead ${m.deadDays}d, ×${m.consecutiveFailures})${m.detail ? ` — ${m.detail}` : ''}`
      );
    }
    lines.push('');
  }

  lines.push(`## Phase-outs applied (${decisions.phaseout.length})`);
  lines.push('');
  if (decisions.phaseout.length) {
    lines.push(
      `Routed to null (dead ≥${PHASEOUT_MIN_AGE_DAYS}d + ≥${PHASEOUT_MIN_FAILURES} failed probes + IANA dropped the line + working RDAP):`
    );
    lines.push('');
    for (const p of decisions.phaseout) {
      lines.push(
        `- **${p.tld}** → ~~${p.server}~~ null (dead ${p.deadDays}d, ×${p.consecutiveFailures})`
      );
    }
  } else {
    lines.push(`_None this run._`);
  }
  lines.push('');

  lines.push(`## Phase-out candidates (${decisions.candidates.length})`);
  lines.push('');
  if (decisions.candidates.length) {
    lines.push(`Dead/failing but not yet phased out:`);
    lines.push('');
    for (const c of decisions.candidates.slice(0, 60)) {
      lines.push(
        `- ${c.tld} → ${c.server} (dead ${c.deadDays}d, ×${c.consecutiveFailures}) — ${c.reason}`
      );
    }
    if (decisions.candidates.length > 60) {
      lines.push(`- …and ${decisions.candidates.length - 60} more (see decisions.json)`);
    }
  } else {
    lines.push(`_None._`);
  }
  lines.push('');

  if (decisions.unhealthyRoutes.length) {
    lines.push(`## Unhealthy routes (${decisions.unhealthyRoutes.length})`);
    lines.push('');
    lines.push(
      `Routes pointing at servers that answered oddly (suspect/error) or with an error page instead of a record (refused) — worth a look:`
    );
    lines.push('');
    for (const u of decisions.unhealthyRoutes.slice(0, 30)) {
      lines.push(
        `- ${u.tld} → ${u.server} [${u.classification}]${u.detail ? ` — ${u.detail}` : ''}`
      );
    }
    lines.push('');
  }

  lines.push(renderThrottlingSection());

  return lines.join('\n');
}

// the servers that throttled a probe, from throttling.json, with the limit the library
// applied: the evidence for adding or tightening an entry in data/limits.json
function renderThrottlingSection(): string {
  const throttling = loadThrottling();
  const entries = Object.entries(throttling).sort(
    ([, a], [, b]) => b.lastSeen.localeCompare(a.lastSeen) || b.runs - a.runs
  );
  const lines = [`## Throttling seen (${entries.length})`, ''];
  if (!entries.length) {
    lines.push('_None recorded._', '');
    return lines.join('\n');
  }
  lines.push(
    'Servers that throttled a probe, the runs they did it in, and the limit the library applied (`published` = from data/limits.json):',
    ''
  );
  for (const [host, t] of entries.slice(0, 40)) {
    const limit = `${t.limit.concurrency} in flight, ${t.limit.minInterval} ms apart${t.published ? ', published' : ''}`;
    lines.push(`- ${host} (${t.protocol}) ×${t.runs}, last ${t.lastSeen.slice(0, 10)} — ${limit}`);
  }
  if (entries.length > 40) lines.push(`- …and ${entries.length - 40} more (see throttling.json)`);
  lines.push('');
  return lines.join('\n');
}

// oracle cross-check summary for the weekly PR body (docs/registry-health.md O5).
// Corpus always runs; the live sample section appears only in write mode.
function renderOracleSection(): string {
  type OracleReport = {
    oracles: string[];
    compared: number;
    buckets: Record<string, number>;
    groups: number;
    newKeys?: string[];
    redKeys?: string[];
  };
  const corpus = loadJson<OracleReport | null>(`${HEALTH_DIR}oracle-compare.json`, null);
  if (!corpus) return '';
  const lines: string[] = ['', '## Oracle cross-check', ''];
  const summarize = (label: string, report: OracleReport): void => {
    lines.push(
      `- ${label}: ${report.compared} response(s) vs ${report.oracles.join('+')} — ` +
        `${report.buckets['we-missing']} we-missing, ${report.buckets['value-mismatch']} ` +
        `value-mismatch, ${report.buckets['we-extra']} we-extra (${report.groups} groups)`
    );
  };
  summarize('corpus', corpus);
  const live = loadJson<OracleReport | null>(`${HEALTH_DIR}oracle-live.json`, null);
  if (live) summarize('live sample', live);
  lines.push('');
  const redKeys = corpus.redKeys ?? [];
  if (redKeys.length) {
    lines.push(`🔴 New top-100 we-missing with 2+ oracles agreeing (${redKeys.length}):`);
    for (const key of redKeys) lines.push(`- **${key}**`);
    lines.push('');
  }
  const newKeys = corpus.newKeys ?? [];
  if (newKeys.length) {
    lines.push(`New divergence groups since last review (${newKeys.length}):`);
    for (const key of newKeys.slice(0, 20)) lines.push(`- ${key}`);
    if (newKeys.length > 20) {
      lines.push(`- …and ${newKeys.length - 20} more (see oracle-compare.json)`);
    }
  } else {
    lines.push(`_No new divergence groups — all current differences previously reviewed._`);
  }
  return lines.join('\n') + '\n';
}

// community server-list diff summary for the weekly PR body (docs/registry-health.md
// S4). Reads the report community-diff.ts wrote this run; only NEW divergences (not yet in
// the committed community-known.json carry-forward) are listed — merging the PR is what
// acknowledges them.
function renderCommunitySection(): string {
  type CommunityReport = {
    perSource: Record<
      string,
      { tlds: number; missingTld: unknown[]; serverDisagrees: unknown[]; weOnly: string[] }
    >;
    agreedMissing: Array<{ tld: string; server: string }>;
    newDivergences: string[];
    adopted?: Record<string, string>;
  };
  const report = loadJson<CommunityReport | null>(`${HEALTH_DIR}community-diff.json`, null);
  if (!report) return '';
  const lines: string[] = ['', '## Community server-list diff', ''];
  for (const [source, diff] of Object.entries(report.perSource)) {
    lines.push(
      `- ${source}: ${diff.tlds} TLDs — ${diff.missingTld.length} missing-tld, ` +
        `${diff.serverDisagrees.length} server-disagrees, ${diff.weOnly.length} we-only`
    );
  }
  const adopted = Object.entries(report.adopted ?? {});
  if (adopted.length) {
    lines.push('');
    lines.push(`Probe-verified additions to the discovered layer (${adopted.length}):`);
    for (const [tld, server] of adopted) lines.push(`- **${tld}** → ${server}`);
  }
  lines.push('');
  if (report.newDivergences.length) {
    lines.push(`New divergences since last review (${report.newDivergences.length}):`);
    for (const key of report.newDivergences.slice(0, 30)) lines.push(`- ${key}`);
    if (report.newDivergences.length > 30) {
      lines.push(`- …and ${report.newDivergences.length - 30} more (see community-diff.json)`);
    }
  } else {
    lines.push(`_No new divergences — all current differences previously reviewed._`);
  }
  return lines.join('\n') + '\n';
}

function main(): void {
  const started = Date.now();

  // ── stage 1: refresh registry truth (whois) ──────────────────────────────
  if (!skipRefresh) {
    run('refresh: IANA TLD sweep', packageScript('whois:update-tlds'));
    run('refresh: cross-diff report', packageScript('registry:cross-diff'));
    // community server-list diff (docs/registry-health.md Leg 1): report always;
    // in write mode also probe-verify missing-tld candidates (alive → discovered layer)
    // and advance the community-known.json carry-forward
    run(
      'refresh: community-diff report',
      packageScript('registry:community-diff', reportOnly ? '' : '--probe')
    );
  } else {
    console.log('skipping refresh (--skip-refresh)');
  }

  // ── stage 2: probe our whois servers ─────────────────────────────────────
  if (!skipProbes) {
    run('probe: whois servers', packageScript('whois:check-servers', probeArgs));
  } else {
    console.log('skipping probes (--skip-probes)');
  }

  // ── stage 3: decide ──────────────────────────────────────────────────────
  console.log('\n=== decide ===');
  // loadState() backfills firstProbeAt for any pre-§10.3 records defensively
  const state = loadState();
  const overrides = loadJson<Record<string, string | null>>(`${WHOIS_DIR}tlds-overrides.json`, {});
  const { rdapListedTlds, rdapHealthyTlds } = loadRdapRouteSets(state.rdap);
  // the outages the last committed run already reported, read before this run overwrites
  // decisions.json
  const knownMoatOutages = new Set(
    loadJson<Partial<Decisions>>(REPORT_JSON, {}).moatOutages?.map(m => m.tld) ?? []
  );
  const decisions = decide({
    tldServers: getTldServers(),
    rdapListedTlds,
    rdapHealthyTlds,
    ianaListsServer: loadIanaListsServer(),
    whoisState: state.whois,
    overriddenTlds: new Set(Object.keys(overrides)),
    knownMoatOutages,
  });

  // Stages 3–4 mutate committed source data (phase-out file, overrides, generated map).
  // --report-only skips all of them: the light CI run decides + reports but writes
  // nothing to the tree, so there is never anything to commit.
  if (reportOnly) {
    console.log('\n--report-only: skipping phase-out write, override prune, and map regenerate');
  } else {
    // Persist phase-outs as the UNION of prior entries and this run's decisions (see
    // mergePhaseout): decide() can't re-propose an already-nulled TLD, so overwriting with
    // only the current run's decisions would silently restore previously-dead routes.
    const existingPhaseout = loadJson<Record<string, string | null>>(PHASEOUT_FILE, {});
    const phaseoutMap = mergePhaseout(
      Object.keys(existingPhaseout),
      decisions.phaseout,
      new Set(Object.keys(overrides))
    );
    mkdirSync(WHOIS_DIR, { recursive: true });
    writeFileSync(PHASEOUT_FILE, JSON.stringify(phaseoutMap, null, 2) + '\n', 'utf8');

    // ── stage 3b: prune redundant overrides ────────────────────────────────
    // An override the automated layers (auto/discovered/phaseout) now reproduce carries no
    // decision — drop it so the owner-managed layer stays minimal (§10.4). Both lanes
    // (whois tlds-overrides.json + RDAP dns-overrides.json). The merged map is unchanged
    // (redundant = identical value), so the regenerate below is a no-op for these removals.
    const pruned = pruneOverrides();
    const prunedAll = [...pruned.whois, ...pruned.rdap];
    if (prunedAll.length) {
      console.log(`\n=== pruned ${prunedAll.length} redundant override(s) ===`);
      for (const r of pruned.whois)
        console.log(`  whois: ${r.tld} = ${r.value ?? 'null'} (now in a lower layer)`);
      for (const r of pruned.rdap)
        console.log(`  rdap:  ${r.tld} = ${r.value ?? 'null'} (now in a lower layer)`);
    }

    // ── stage 4: regenerate the committed map (picks up any phase-outs) ─────
    run('regenerate committed map', packageScript('whois:generate:tlds'));
  }

  // ── stage 5: offline parser regression (no network) ──────────────────────
  // --strict makes it exit non-zero on a top-100 TLD regression; catch so the run
  // still reports, and fold that into the red decision below (plan §6).
  let parserRed = false;
  try {
    run('parser regression', packageScript('whois:check-parsers', '--strict'));
  } catch {
    parserRed = true;
  }
  const parser = loadJson<{ score: string; top100Regressions: number; checked: number }>(
    `${HEALTH_DIR}parser-report.json`,
    { score: '?', top100Regressions: 0, checked: 0 }
  );

  // ── stage 5b: oracle cross-check (docs/registry-health.md Leg 2) ───
  // Corpus mode is offline like the parser regression: every fixture re-parsed by us and
  // by whichever oracles are built (whoiser always; the Go/Ruby wrappers when CI or a dev
  // built them). --strict is red only on a NEW we-missing group on a top-100 target with
  // 2+ oracles agreeing; --write advances the oracle-known.json carry-forward. In write
  // mode a small live sample (proxied) also runs — report-only signal, so a
  // flaky network never fails the sweep.
  let oracleRed = false;
  try {
    run(
      'oracle cross-check',
      packageScript('whois:oracle-compare', reportOnly ? '--strict' : '--strict --write')
    );
  } catch {
    oracleRed = true;
  }
  if (!reportOnly) {
    try {
      run('oracle live sample', packageScript('whois:oracle-compare', '--live 25'));
    } catch {
      console.log('oracle live sample failed (network) — continuing, corpus already ran');
    }
  }
  const oracle = loadJson<{ redKeys: string[] }>(`${HEALTH_DIR}oracle-compare.json`, {
    redKeys: [],
  });

  // ── stage 6: discovery (opt-in — slow, propose-only) ─────────────────────
  if (discover) {
    run('discover: whois replacements', packageScript('whois:discover'));
  }

  // ── stage 7: report ──────────────────────────────────────────────────────
  mkdirSync(HEALTH_DIR, { recursive: true });
  writeFileSync(REPORT_JSON, JSON.stringify(decisions, null, 2) + '\n', 'utf8');
  let md = renderReport(decisions, state.whois, knownMoatOutages);
  md += `\n## Parser regression\n\n${parser.checked} fixtures, ${parser.score}% parse clean; ${parser.top100Regressions} top-100 regression(s).\n`;
  md += renderOracleSection();
  md += renderCommunitySection();
  md += renderRegistrarSection();
  writeFileSync(REPORT_MD, md + '\n', 'utf8');

  const red = decisions.red || parserRed || oracleRed;
  console.log('\n' + md);
  console.log(`\ndecisions: registry-health/decisions.json + report.md`);
  console.log(`elapsed: ${Math.round((Date.now() - started) / 1000)}s`);

  if (red) {
    const reasons = [
      decisions.red ? 'new moat outage(s)' : null,
      parserRed ? `${parser.top100Regressions} top-100 parser regression(s)` : null,
      oracleRed ? `${oracle.redKeys.length} new top-100 oracle divergence(s)` : null,
    ].filter(Boolean);
    console.error(`\n🔴 RED: ${reasons.join(' + ')} — see report`);
    process.exit(1);
  }
  console.log(`\n✅ green (data drift lands as a reviewable diff)`);
  process.exit(0);
}

main();
