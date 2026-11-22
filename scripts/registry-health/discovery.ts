// The shared discovery-source interface (docs/registry-health.md §10.4). Discovery paths
// differ per protocol (rdap.org for RDAP; community whois lists for whois), so the two
// discover scripts differ — but every source they consult implements this one shape, so a
// new source (another GitHub list, a scraper) plugs in without touching the orchestrators.
//
// A source proposes candidate server(s) for a TLD; it NEVER decides. The orchestrator
// probe-verifies each candidate with the existing M2 harness before anything is written,
// and even then only as a reviewable proposed diff (candidates are never auto-adopted).
export type DiscoveryResult = {
  // proposed servers for this TLD — RDAP base URLs or whois hosts depending on the source;
  // empty when the source has nothing for it
  servers: string[];
};

export interface DiscoverySource {
  name: string;
  // may lazily fetch/cache a whole upstream list on first call
  lookup(tld: string): Promise<DiscoveryResult>;
  // the source's ENTIRE tld → server map (docs/registry-health.md S1). The whois
  // community sources fetch this map anyway to answer lookup(); exposing it lets the
  // community-diff lane compare full maps instead of only the discovery problem set.
  // Optional: a source that can only answer per-TLD (a scraper, an API) omits it.
  loadAll?(): Promise<Map<string, string>>;
}

// per-source productivity for a discovery run: how many candidates the source returned,
// how many probed alive, and how many were actually adopted (first-alive-wins). A source
// that stays at 0 across runs is dead weight — it only echoes IANA/another source and can
// be dropped (docs/registry-health.md §10.4).
export type SourceStats = { candidates: number; verifiedAlive: number; adopted: number };

export function summarizeBySource(
  sourceNames: string[],
  attempts: Array<{ source: string; candidate: boolean; alive: boolean }>,
  adoptedSource: Record<string, string>
): Record<string, SourceStats> {
  const bySource: Record<string, SourceStats> = {};
  for (const name of sourceNames) bySource[name] = { candidates: 0, verifiedAlive: 0, adopted: 0 };
  for (const a of attempts) {
    const stats = bySource[a.source];
    if (!stats || !a.candidate) continue; // skip source-level errors (no candidate returned)
    stats.candidates++;
    if (a.alive) stats.verifiedAlive++;
  }
  for (const source of Object.values(adoptedSource)) {
    if (bySource[source]) bySource[source].adopted++;
  }
  return bySource;
}
