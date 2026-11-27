#!/usr/bin/env tsx
// `npm run registry:health` — the scheduled unit (docs/registry-health.md §10.1). A thin
// wrapper that runs the three health lanes in dependency order:
//
//   1. rdap:health        (standalone: refresh bootstrap → probe RDAP → owns state.rdap)
//   2. registrars:health  (standalone: registrar list → probe registrar servers → owns
//                          state.registrars; never red)
//   3. whois:health       (IANA sweep → probe whois → decide → regenerate → parser check →
//                          the report, registrar section included)
//
// The order is load-bearing: the whois decision engine reads the COMMITTED rdap state
// that rdap:health just wrote — a whois server is only phased out when the TLD has a
// probe-verified working RDAP route (§10.2). rdap:health never fails the build; whois:
// health does (moat outage or top-100 parser regression), and its non-zero exit
// propagates through here so the scheduled run stays red on an actionable regression.
//
// All flags are forwarded verbatim to both lanes (each ignores the ones it doesn't
// use): --skip-refresh, --skip-probes, --decide-only, --full-sweep, --discover,
// --report-only, and the value-flags --sample N / --limit N (light-CI sampling).
import { execSync } from 'node:child_process';
import { packageScript } from '../lib/run';
import { PACKAGE_DIR } from '../lib/paths';

// forward only recognized `--flags` (developer/CI-typed and controlled), keeping the
// value token for the value-flags so `--sample 10` isn't truncated to a bare `--sample`.
const VALUE_FLAGS = new Set(['--sample', '--limit']);
const argv = process.argv.slice(2);
const forwarded: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (!arg.startsWith('--')) continue;
  forwarded.push(arg);
  const value = argv[i + 1];
  if (VALUE_FLAGS.has(arg) && value && !value.startsWith('--')) {
    forwarded.push(value);
    i++;
  }
}
const passthrough = forwarded.join(' ');

function run(label: string, command: string): void {
  console.log(`\n########## ${label} ##########`);
  execSync(command, { cwd: PACKAGE_DIR, stdio: 'inherit' });
}

function main(): void {
  const started = Date.now();

  // rdap first — the whois decision reads the rdap state this produces
  run('rdap:health', packageScript('rdap:health', passthrough));

  // registrars before whois, whose report renders their section and whose red exit would
  // otherwise skip them
  run('registrars:health', packageScript('registrars:health', passthrough));

  // whois last — throws (→ non-zero exit here) on an actionable regression
  run('whois:health', packageScript('whois:health', passthrough));

  console.log(`\n✅ registry:health done (${Math.round((Date.now() - started) / 1000)}s)`);
  process.exit(0);
}

main();
