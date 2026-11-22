// triage what the eppStatus pipeline keeps and what it drops, across the whole golden corpus.
// eppStatus holds EPP codes only, so anything a registry writes in its own vocabulary is
// dropped (eppStatusRaw keeps it). this answers "is that drop a code in disguise, or is it
// genuinely not EPP" — run it after touching WHOIS_EPP_STATUS_MAP or cleanStatus
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { arrayFormatter } from '../../src/whois/base';
import { cleanStatus, whoisGetEppStatus } from '../../src/whois/utils';
import { WHOIS_FIXTURES_DIR } from '../lib/paths';

const FIXTURES = WHOIS_FIXTURES_DIR;
const DIRS = ['found', 'merged', 'reserved', 'unclassified', 'vendored'];

// the mapped side is keyed by "input -> code" rather than just the code, so a dead map entry
// (one no registry actually writes) is visible as an absent row
const mapped = new Map<string, number>();
const dropped = new Map<string, { count: number; servers: Set<string> }>();

for (const dir of DIRS) {
  let files: string[];
  try {
    files = readdirSync(join(FIXTURES, dir)).filter(f => f.endsWith('.json'));
  } catch {
    continue;
  }

  for (const file of files) {
    const golden = JSON.parse(readFileSync(join(FIXTURES, dir, file), 'utf8'));
    if (!golden.eppStatusRaw) continue;

    // fixtures are named <server>___<domain>.json
    const server = file.split('___')[0] || file;

    // mirror statusFormatter exactly: arrayFormatter splits, then cleanStatus, then the map
    for (const piece of arrayFormatter(golden.eppStatusRaw)) {
      const cleaned = cleanStatus(piece);
      if (!cleaned) continue;

      const epp = whoisGetEppStatus(cleaned);
      if (epp) {
        const key = `${cleaned.toLowerCase()}  ->  ${epp}`;
        mapped.set(key, (mapped.get(key) ?? 0) + 1);
        continue;
      }

      const entry = dropped.get(cleaned) ?? { count: 0, servers: new Set<string>() };
      entry.count += 1;
      entry.servers.add(server);
      dropped.set(cleaned, entry);
    }
  }
}

const byCount = <T>(m: Map<string, T>, n: (v: T) => number) =>
  [...m].sort((a, b) => n(b[1]) - n(a[1]));

console.log(`\n=== MAPPED (${mapped.size} distinct inputs) ===`);
for (const [key, count] of byCount(mapped, v => v)) {
  console.log(`${String(count).padStart(5)}  ${key}`);
}

console.log(`\n=== DROPPED (${dropped.size} distinct values) ===`);
for (const [value, { count, servers }] of byCount(dropped, v => v.count)) {
  const shown = [...servers].slice(0, 3).join(', ');
  const more = servers.size > 3 ? ` +${servers.size - 3} more` : '';
  console.log(`${String(count).padStart(5)}  ${JSON.stringify(value)}  [${shown}${more}]`);
}
