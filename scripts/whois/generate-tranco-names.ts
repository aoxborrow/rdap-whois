// Regenerate the per-TLD known-registered-name pool (scripts/data/tranco-names.json) that the
// corpus sweeps draw candidate domains from (whois/scripts/archive/sweep-corpus.ts + diff-sweep.ts).
//
// WHY DEEPER + STRATIFIED (docs/archive/whois-parser-refactor.md §6ah). The old pool took the top 5
// names per TLD from the top ~1k of a Tranco list — all high-traffic, all ORG registrants. So
// the sweeps only ever sampled the "big company" variant of each registry, and a bug living in
// another variant (an INDIVIDUAL registrant with no org-name line → .it registrant_name="Pisa";
// a bare-2LD layout → whois.jprs.jp 7→1 on `.jp` vs its `co.jp` fixture) was never fetched, so
// no fixture covered it and the A/B gate stayed green over the hole. Deepening the pool is the
// durable fix: broader + rank-diverse candidates → more variants banked → the golden scoreboard
// itself asserts those fields, no value-shape heuristic needed.
//
// STRATIFICATION: for each TLD we take up to CAP names spread EVENLY across the full rank range
// of that TLD's entries (rank 1 … rank ~1M), not just the head. Deep-rank entries are smaller
// sites — far more likely to be individual/small-business registrations that exercise the
// redacted / no-org-name / minimal-contact layouts the head never does.
//
// The raw Tranco list is NOT committed (~30 MB). Fetch the latest and pass it in:
//   id=$(curl -s https://tranco-list.eu/api/lists/date/latest | sed 's/.*"list_id": "\([^"]*\)".*/\1/')
//   curl -s -o /tmp/tranco-full.csv "https://tranco-list.eu/download/$id/1000000"
//   npm run whois:gen-tranco-names --csv /tmp/tranco-full.csv
// The committed artifact is scripts/data/tranco-names.json (deterministic for a given list).
import { createReadStream, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { getTldServers } from './generate-tlds';

const OUTPUT_FILE = fileURLToPath(new URL('./data/tranco-names.json', import.meta.url));

// names per TLD. gTLD registries are thin+uniform (one registry parser, referral to registrars),
// so more names buy little variance there; ccTLDs carry the per-server-parser risk, so the
// default is generous. com/net/org stay modest — their variance is a registrar concern, not a
// registry-parser one.
const DEFAULT_CAP = 20;
const CAP_EXCEPTIONS: Record<string, number> = { com: 30, net: 30, org: 30 };

function getFlag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

// the TLD a domain belongs to: the LONGEST known routing-map suffix it ends with (so
// `google.co.jp` → `co.jp` when that's routed, else `jp`). Same rule as sweep-corpus.tldOf,
// so a name buckets under a key the sweeps' server→TLD map can actually find. Start at the
// second label — a bare `nic.it` belongs to `it`, never to `nic.it`.
function tldOf(domain: string, known: Set<string>): string | null {
  const labels = domain.toLowerCase().split('.');
  for (let i = 1; i < labels.length; i++) {
    const candidate = labels.slice(i).join('.');
    if (known.has(candidate)) return candidate;
  }
  return null;
}

// up to `cap` items spread evenly across a rank-ordered array (indices 0 … n-1), so the sample
// spans the most-popular through the deepest entry rather than clustering at the head.
function stratifiedSample<T>(rankSorted: T[], cap: number): T[] {
  if (rankSorted.length <= cap) return rankSorted;
  const out: T[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < cap; i++) {
    const idx = Math.round((i * (rankSorted.length - 1)) / (cap - 1));
    if (!seen.has(idx)) {
      seen.add(idx);
      out.push(rankSorted[idx]);
    }
  }
  return out;
}

async function main(): Promise<void> {
  const csvPath = getFlag('csv');
  if (!csvPath) {
    console.error(
      'usage: whois:gen-tranco-names --csv <tranco-full.csv>  (see header for the download)'
    );
    process.exit(1);
  }

  const known = new Set(Object.keys(getTldServers()));
  const byTld = new Map<string, string[]>(); // rank-ascending (CSV order)

  const rl = createInterface({ input: createReadStream(csvPath), crlfDelay: Infinity });
  let rows = 0;
  for await (const line of rl) {
    const comma = line.indexOf(',');
    if (comma < 0) continue;
    const domain = line
      .slice(comma + 1)
      .trim()
      .toLowerCase();
    if (!domain || domain.includes(' ')) continue;
    rows++;
    const tld = tldOf(domain, known);
    if (!tld) continue;
    const list = byTld.get(tld) ?? [];
    // hard ceiling on retained rows per TLD so a huge TLD doesn't hoard memory; keep well above
    // any CAP so the stratification still spans the real rank range (10× the largest exception).
    if (list.length < 3000) {
      list.push(domain);
      byTld.set(tld, list);
    }
  }

  const result: Record<string, string[]> = {};
  for (const tld of [...byTld.keys()].sort()) {
    const cap = CAP_EXCEPTIONS[tld] ?? DEFAULT_CAP;
    const sample = stratifiedSample(byTld.get(tld)!, cap);
    if (sample.length) result[tld] = sample;
  }

  writeFileSync(OUTPUT_FILE, JSON.stringify(result, null, 2) + '\n', 'utf8');
  const total = Object.values(result).reduce((s, a) => s + a.length, 0);
  console.log(
    `read ${rows} rows → ${Object.keys(result).length} TLDs, ${total} names ` +
      `(avg ${(total / Object.keys(result).length).toFixed(1)}/TLD, cap ${DEFAULT_CAP}) → ${OUTPUT_FILE}`
  );
  process.exit(0);
}

main().catch(e => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
