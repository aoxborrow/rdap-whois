import {
  DOMAIN_QUERY_TYPE,
  ASN_QUERY_TYPE,
  IP_QUERY_TYPE,
  ENTITY_QUERY_TYPE,
  IANA_SERVER_TYPE,
  REGIONAL_SERVER_TYPE,
  REGISTRY_SERVER_TYPE,
} from '../common/constants';
import type { WhoisServer } from './data-types';

// IANA whois server, default for TLDs, fall back for everything else
export const IANA_WHOIS_SERVER = 'whois.iana.org';

// legacy → canonical whois hostnames. When a registry renames its whois host we route
// the TLD to the new name, but callers may still pass the old one explicitly (saved
// params, bookmarks) — and the old host often still resolves to the same box. Aliasing
// here keeps SPECIAL_SERVERS query strings and the per-server parser working for those
// callers without duplicating config/parser data under both names.
export const WHOIS_SERVER_ALIASES: Record<string, string> = {
  // DK Hostmaster → Punktum dk (2025 rename; old host still resolves to the same IP)
  'whois.dk-hostmaster.dk': 'whois.punktum.dk',
};

// resolve a whois hostname to its canonical form (identity if not aliased)
export function resolveServerAlias(host: string): string {
  return WHOIS_SERVER_ALIASES[host] ?? host;
}

/** the regional internet registries' WHOIS servers, by registry */
export const WHOIS_REGIONAL_REGISTRIES = {
  ARIN: 'whois.arin.net',
  RIPE: 'whois.ripe.net',
  APNIC: 'whois.apnic.net',
  LACNIC: 'whois.lacnic.net',
  AFRINIC: 'whois.afrinic.net',
} as const;

// The servers that answer in a character encoding other than UTF-8, as TextDecoder names it.
// A response is decoded as UTF-8 unless its server is here, and a server listed here is
// decoded this way whether it is asked first or reached by a referral. Each entry is a
// server whose raw bytes were seen not to be valid UTF-8: registro.br writes "Núcleo" as
// N 0xFA cleo, and dinahosting, a registrar, writes accented contact names the same way
export const WHOIS_SERVER_ENCODINGS: Record<string, string> = {
  'whois.registro.br': 'iso-8859-1',
  'whois.dinahosting.com': 'iso-8859-1',
};

// whois servers with special query options
// some more here: https://github.com/ocku/nicname/blob/main/src/constants/servers.ts
export const SPECIAL_SERVERS: WhoisServer[] = [
  {
    // IANA whois server, default for TLDs, fall back for everything else
    host: 'whois.iana.org',
    serverType: IANA_SERVER_TYPE,
  },
  {
    // Default WHOIS server for IP addresses
    // Query-by-record-type:
    // ---------------------
    // To limit your query to a specific record type, include one of the following
    // flags:
    //       n       Network address space
    //       r       CIDRized network space
    //       d       Delegations
    //       a       Autonomous systems
    //       p       Points-of-contact
    //       o       Organizations
    //       c       End-user customers
    //       e       Points-of-contact, Organizations, End-user customers
    //       z       All of the above
    //
    // Display flags:
    // --------------
    // To modify the way that the query results display, include one of the
    // following flags:
    //       +       FULL output shows detailed display for EACH match
    //       -       LIST output shows summary only, even if single match
    //               returned
    // e.g. whois -h whois.arin.net "n + 8.8.8.8"
    host: 'whois.arin.net',
    serverType: REGIONAL_SERVER_TYPE,
    queryString: 'z + $query',
    queryTypes: {
      [DOMAIN_QUERY_TYPE]: 'z + $query',
      [IP_QUERY_TYPE]: 'n + $query', // TODO: use 'r' for CIDR queries
      [ASN_QUERY_TYPE]: 'a + $query',
      [ENTITY_QUERY_TYPE]: 'e + $query',
    },
  },
  {
    // https://www.ripe.net/media/documents/RDB-RIPE_Database_Reference_16_9.pdf
    // e.g. whois -h whois.ripe.net -- -L 2a01:e35:2f22:e3d0::1
    host: 'whois.ripe.net',
    serverType: REGIONAL_SERVER_TYPE,
    queryString: '$query',
    queryTypes: {
      [DOMAIN_QUERY_TYPE]: '$query',
      [IP_QUERY_TYPE]: '$query',
      [ASN_QUERY_TYPE]: '$query',
      [ENTITY_QUERY_TYPE]: '$query',
    },
  },
  {
    host: 'whois.apnic.net',
    serverType: REGIONAL_SERVER_TYPE,
    queryTypes: {
      [DOMAIN_QUERY_TYPE]: '$query',
      [IP_QUERY_TYPE]: '$query',
      [ASN_QUERY_TYPE]: '$query',
      [ENTITY_QUERY_TYPE]: '$query',
    },
  },
  {
    host: 'whois.lacnic.net',
    serverType: REGIONAL_SERVER_TYPE,
    queryTypes: {
      [DOMAIN_QUERY_TYPE]: '$query',
      [IP_QUERY_TYPE]: '$query',
      [ASN_QUERY_TYPE]: '$query',
      [ENTITY_QUERY_TYPE]: '$query',
    },
  },
  {
    host: 'whois.afrinic.net',
    serverType: REGIONAL_SERVER_TYPE,
    queryTypes: {
      [DOMAIN_QUERY_TYPE]: '$query',
      [IP_QUERY_TYPE]: '$query',
      [ASN_QUERY_TYPE]: '$query',
      [ENTITY_QUERY_TYPE]: '$query',
    },
  },
  {
    host: 'whois.denic.de',
    serverType: REGISTRY_SERVER_TYPE,
    queryString: '-T dn,ace $query',
  },
  {
    // DK Hostmaster renamed to Punktum dk; the old whois.dk-hostmaster.dk hostname
    // still resolves to the same IP, but IANA and the registry use punktum now
    host: 'whois.punktum.dk',
    serverType: REGISTRY_SERVER_TYPE,
    queryString: '--charset=utf-8 --show-handles $query',
  },
  {
    host: 'whois.jprs.jp',
    serverType: REGISTRY_SERVER_TYPE,
    queryString: '$query/e',
  },
  {
    host: 'whois.norid.no',
    serverType: REGISTRY_SERVER_TYPE,
    queryString: '-c utf-8 $query',
  },
];
