// The resolved routing table, data/tlds.json: for every zone the routing layers name, its
// WHOIS server and RDAP base URL, and the layer each came from. scripts/whois/generate-tlds.ts
// writes it from the layers in data/whois/ and data/rdap/, so nothing merges them at runtime.
// The servers are in the forms the lookups route by and registry-health/state.json keys
// health on: a normalized WHOIS host, an RDAP base URL from normalizeRdapServer
import tlds from '../data/tlds.json';

// the WHOIS layer a server came from, lowest first: the static snapshot, second-level
// additions, the IANA sweep, probe-verified replacements, decided phase-outs, hand overrides
export type WhoisSource = 'ascii' | 'extra' | 'auto' | 'discovered' | 'phaseout' | 'overrides';

// the RDAP layer a base URL came from: IANA's bootstrap file, a probe-verified server IANA
// does not list, a hand override
export type RdapSource = 'iana' | 'discovered' | 'overrides';

export interface TldRoute {
  // the zone's WHOIS server, or null for none
  whois: string | null;
  // the layer that set it, or null when no WHOIS layer names the zone
  whoisSource: WhoisSource | null;
  // the zone's RDAP base URL, or null for none
  rdap: string | null;
  // the layer that set it, or null when no RDAP layer names the zone
  rdapSource: RdapSource | null;
}

const TLDS = tlds as Readonly<Record<string, TldRoute>>;

// the table's route for a zone, or undefined for a zone it does not name
export function tldRoute(zone: string): TldRoute | undefined {
  return Object.hasOwn(TLDS, zone) ? TLDS[zone] : undefined;
}

// every zone in the table with its route
export function tldRoutes(): [string, TldRoute][] {
  return Object.entries(TLDS);
}
