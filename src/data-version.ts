// how old the routing data and limits built into this release are, as UTC dates
// (YYYY-MM-DD). There is no update at runtime: new data comes with a new release.
import knownLimits from '../data/limits.json';
import dnsBootstrap from '../data/rdap/dns.json';
import { TLD_TABLE_UPDATED } from './whois/generated/tlds-updated';

export interface DataVersion {
  // when IANA published the RDAP bootstrap file for domains (data/rdap/dns.json)
  rdapBootstrap: string;
  // when the WHOIS server table last changed
  whoisTables: string;
  // when the per-server request limits (KNOWN_SERVER_LIMITS) last changed
  limits: string;
}

export const DATA_VERSION: Readonly<DataVersion> = Object.freeze({
  rdapBootstrap: dnsBootstrap.publication.slice(0, 10),
  whoisTables: TLD_TABLE_UPDATED,
  limits: knownLimits.updated,
});
