#!/usr/bin/env tsx
// `npm run rdap:health` — the RDAP lane of the registry-health pipeline
// (docs/registry-health.md §10.1). Standalone: it depends on nothing else in the
// suite and owns the `rdap` lane of registry-health/state.json.
//
//   1. refresh the IANA RDAP bootstrap  (rdap:update → data/rdap/*.json)
//   2. probe every unique RDAP base URL (rdap:check-servers → state.rdap)
//   3. (opt-in) rdap discovery over the problem set (rdap:discover → §10.4)
//
// This lane runs FIRST in the scheduled unit (registry:health) because the whois
// decision engine reads the committed rdap state it produces — a whois server can only
// be phased out when the TLD has a probe-verified working RDAP route (§10.2). The rdap
// lane has no red conditions of its own (a dead RDAP base is data drift, reported by
// the whois lane as the reason a phase-out is withheld), so it always exits 0.
//
//   --skip-refresh   don't re-download the IANA bootstrap
//   --skip-probes    don't re-probe RDAP bases (reuse the existing state.json)
//   --decide-only    skip both network stages (= --skip-refresh --skip-probes)
//   --discover       after probing, run rdap:discover over the problem set
//   --sample N       probe a random N-of-all sample of bases (light CI sweep)
//   --limit N        probe the first N bases (alphabetical)
//   --report-only    don't persist state.json (report-only CI runs; forwards --no-save)
import { execSync } from 'node:child_process';
import { PACKAGE_DIR } from '../lib/paths';
import { packageScript } from '../lib/run';

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
const sample = flagValue('sample');
const limit = flagValue('limit');
const probeArgs = [
  sample ? `--sample ${sample}` : '',
  limit ? `--limit ${limit}` : '',
  reportOnly || flags.has('--no-save') ? '--no-save' : '',
]
  .filter(Boolean)
  .join(' ');

function run(label: string, command: string): void {
  console.log(`\n=== ${label} ===`);
  execSync(command, { cwd: PACKAGE_DIR, stdio: 'inherit' });
}

function main(): void {
  const started = Date.now();

  // ── stage 1: refresh the IANA RDAP bootstrap ─────────────────────────────
  if (!skipRefresh) {
    run('refresh: RDAP bootstrap', packageScript('rdap:update'));
  } else {
    console.log('skipping refresh (--skip-refresh)');
  }

  // ── stage 2: probe RDAP bases ────────────────────────────────────────────
  if (!skipProbes) {
    run('probe: RDAP bases', packageScript('rdap:check-servers', probeArgs));
  } else {
    console.log('skipping probes (--skip-probes)');
  }

  // ── stage 3: discovery (opt-in — slow, propose-only) ─────────────────────
  if (discover) {
    run('discover: RDAP endpoints', packageScript('rdap:discover'));
  }

  console.log(`\n✅ rdap:health done (${Math.round((Date.now() - started) / 1000)}s)`);
  console.log(
    reportOnly || flags.has('--no-save')
      ? '(report-only — state.json not written)'
      : 'state updated: registry-health/state.json (rdap lane)'
  );
  process.exit(0);
}

main();
