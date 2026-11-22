// Derive the discovery problem set (docs/registry-health.md §10.4) from the COMMITTED
// probe state + the merged routing maps. Discovery input is the PROBLEM SET — servers that
// are dead, and TLDs with no working lookup — not all ~1,500 TLDs. Reading prior-run
// committed state is deliberate: discovery is slow and propose-only, so last run's verdict
// is fine, and it keeps the rdap lane independent of the whois lane at runtime (§10.1).
import { DnsServerCache } from '../../src/rdap/cache/dns';
import { getTldServers } from '../whois/generate-tlds';
import { loadState } from './state';

export type ProblemSet = {
  // TLDs whose routed whois server last probed dead-candidate → want a replacement whois
  deadWhois: Array<{ tld: string; server: string }>;
  // top-level whois-only TLDs with NO RDAP route at all (the moat) → want any RDAP
  whoisOnlyNoRdap: string[];
  // TLDs whose RDAP route is listed but last probed unhealthy → want a working RDAP
  rdapUnhealthy: string[];
};

export function computeProblemSet(): ProblemSet {
  const tldServers = getTldServers();
  const state = loadState();
  const cache = new DnsServerCache();

  // RDAP route sets (same construction the whois decision uses, §10.2)
  const rdapListed = new Set<string>();
  const rdapHealthy = new Set<string>();
  for (const [tld, base] of cache.entries()) {
    const key = tld.toLowerCase();
    rdapListed.add(key);
    if (state.rdap[base]?.classification === 'healthy') rdapHealthy.add(key);
  }

  const deadWhois: Array<{ tld: string; server: string }> = [];
  const whoisOnlyNoRdap: string[] = [];
  for (const [tld, server] of Object.entries(tldServers)) {
    if (!server) continue;
    if (state.whois[server]?.classification === 'dead-candidate') {
      deadWhois.push({ tld, server });
    }
    // moat set: a real top-level TLD with whois and no RDAP route at all
    if (!tld.includes('.') && !rdapListed.has(tld)) {
      whoisOnlyNoRdap.push(tld);
    }
  }

  const rdapUnhealthy = [...rdapListed].filter(tld => !rdapHealthy.has(tld)).sort();

  deadWhois.sort((a, b) => a.tld.localeCompare(b.tld));
  whoisOnlyNoRdap.sort();

  return { deadWhois, whoisOnlyNoRdap, rdapUnhealthy };
}
