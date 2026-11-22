// Auto-prune redundant entries from the owner-managed override layers (docs
// registry-health.md §10.4). An override whose value the automated layers BELOW it already
// produce carries no decision — the sweep/discovery has caught up — so the job removes it
// and the merged routing is unchanged (the lower layer produces the identical value). This
// is the "move stuff out of overrides once the normal data produces it" rule: the hand
// layer shrinks to only the entries that genuinely deviate. Owner opted in; the committed
// diff (a shrunk overrides file) is the review gate, and only redundant entries are touched
// — a deviating override (amazon → whois.iana.org, abbvie → null) is never removed.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mergeTldLayers } from './generate-tlds';
import { normalizeRdapServer } from '../../src/rdap/utils';
import { normalizeServer } from '../../src/common/utils';
import { RDAP_DATA_DIR, WHOIS_DATA_DIR } from '../lib/paths';

const WHOIS_DIR = WHOIS_DATA_DIR;
const RDAP_DIR = RDAP_DATA_DIR;

type TldMap = Record<string, string | null>;
export type PrunedEntry = { tld: string; value: string | null };

function loadJson(path: string): TldMap {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as TldMap) : {};
}

// PURE: partition an override map into what to keep vs what's redundant. An entry is
// redundant when its normalized value equals the normalized value the base map (the merge
// of every layer BELOW overrides) already produces for that TLD — including null == null
// (e.g. a manual null the phase-out gate now also produces).
export function computePrune(
  overrides: TldMap,
  base: TldMap,
  normalize: (host: string) => string
): { pruned: TldMap; removed: PrunedEntry[] } {
  const norm = (host: string | null): string | null => (host == null ? null : normalize(host));
  const pruned: TldMap = {};
  const removed: PrunedEntry[] = [];
  for (const [tld, value] of Object.entries(overrides)) {
    const baseValue = tld in base ? base[tld] : null;
    if (norm(value) === norm(baseValue)) {
      removed.push({ tld, value });
    } else {
      pruned[tld] = value;
    }
  }
  return { pruned, removed };
}

// the RDAP domain merge WITHOUT the override layer — bootstrap (first URL per pattern) ←
// discovered, matching DnsServerCache minus the overrides pass.
function rdapBaseWithoutOverrides(): TldMap {
  const base: TldMap = {};
  const bootstrap = JSON.parse(readFileSync(`${RDAP_DIR}dns.json`, 'utf8')) as {
    services: string[][][];
  };
  for (const [patterns, urls] of bootstrap.services) {
    for (const pattern of patterns) base[pattern.toLowerCase()] = urls[0];
  }
  for (const [tld, url] of Object.entries(loadJson(`${RDAP_DIR}dns-discovered.json`))) {
    base[tld.toLowerCase()] = url;
  }
  return base;
}

function writeSorted(path: string, map: TldMap): void {
  const sorted = Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(path, JSON.stringify(sorted, null, 2) + '\n', 'utf8');
}

// I/O: prune both override files in place (writes only when something is removed, so a
// clean run touches nothing). Returns what was removed per lane. The whois caller must
// regenerate the committed map afterwards (a no-op for redundant removals).
export function pruneOverrides(): { whois: PrunedEntry[]; rdap: PrunedEntry[] } {
  const whoisFile = `${WHOIS_DIR}tlds-overrides.json`;
  const rdapFile = `${RDAP_DIR}dns-overrides.json`;

  // "redundant" = the merged map would be identical without this override, so the base is
  // every layer BELOW overrides — the shared merge, minus the overrides pass.
  const whois = computePrune(
    loadJson(whoisFile),
    mergeTldLayers({ includeOverrides: false }),
    normalizeServer
  );
  if (whois.removed.length) writeSorted(whoisFile, whois.pruned);

  const rdap = computePrune(loadJson(rdapFile), rdapBaseWithoutOverrides(), normalizeRdapServer);
  if (rdap.removed.length) writeSorted(rdapFile, rdap.pruned);

  return { whois: whois.removed, rdap: rdap.removed };
}
