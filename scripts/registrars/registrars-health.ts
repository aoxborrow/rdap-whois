#!/usr/bin/env tsx
// `npm run registrars:health` — the registrar lane of the registry-health run
// (docs/registry-health.md, "Registrars"). Standalone, like the RDAP lane:
//
//   1. rebuild the registrar server list  (registrars:update → registry-health/registrars.json)
//   2. probe every registrar server        (registrars:check-servers → state.registrars)
//
// Its outcome is reported, never red: a registrar's server going down breaks no TLD route, so
// the lane always exits 0. The whois lane's report renders its section.
//
//   --skip-refresh   don't rebuild the list (probe the committed one)
//   --skip-probes    don't probe (keep the existing state)
//   --decide-only    skip both (= --skip-refresh --skip-probes)
//   --sample N       probe a random N of each protocol's servers
//   --limit N        probe the first N of each
//   --report-only    write nothing (forwards --no-save)
import { execSync } from 'node:child_process';
import { PACKAGE_DIR } from '../lib/paths';
import { packageScript } from '../lib/run';

const flags = new Set(process.argv.slice(2).filter(a => a.startsWith('--')));
const skipRefresh = flags.has('--skip-refresh') || flags.has('--decide-only');
const skipProbes = flags.has('--skip-probes') || flags.has('--decide-only');
const noSave = flags.has('--report-only') || flags.has('--no-save');

function flagValue(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : undefined;
}

const sample = flagValue('sample');
const limit = flagValue('limit');
const probeArgs = [
  sample ? `--sample ${sample}` : '',
  limit ? `--limit ${limit}` : '',
  noSave ? '--no-save' : '',
]
  .filter(Boolean)
  .join(' ');

function run(label: string, command: string): boolean {
  console.log(`\n=== ${label} ===`);
  try {
    execSync(command, { cwd: PACKAGE_DIR, stdio: 'inherit' });
    return true;
  } catch {
    console.log(`${label} failed — continuing`);
    return false;
  }
}

const started = Date.now();
if (skipRefresh) {
  console.log('skipping refresh (--skip-refresh)');
} else {
  run('refresh: registrar list', packageScript('registrars:update', noSave ? '--no-save' : ''));
}
if (skipProbes) {
  console.log('skipping probes (--skip-probes)');
} else {
  run('probe: registrar servers', packageScript('registrars:check-servers', probeArgs));
}
console.log(`\n✅ registrars:health done (${Math.round((Date.now() - started) / 1000)}s)`);
process.exit(0);
