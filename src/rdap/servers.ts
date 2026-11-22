import { AsnServerCache } from './cache/asn';
import { DnsServerCache } from './cache/dns';
import { EntityServerCache } from './cache/entity';
import { Ipv4ServerCache } from './cache/ipv4';
import { Ipv6ServerCache } from './cache/ipv6';
import { IANA_RDAP_SERVER, RDAP_REGIONAL_REGISTRIES } from './constants';
import { RdapQueryType, RdapServerCache, RdapServerType } from './types';
import { normalizeRdapServer } from './utils';
import {
  DOMAIN_QUERY_TYPE,
  IANA_SERVER_TYPE,
  REGIONAL_SERVER_TYPE,
  REGISTRY_SERVER_TYPE,
  UNKNOWN_SERVER_TYPE,
} from '../common/constants';

// Each bootstrap file is turned into its lookup map the first time a query needs it, so
// importing the library costs nothing and a program that only looks up domains never builds
// the IP, AS number or entity maps
let dnsCache: DnsServerCache | undefined;
let ipv4Cache: Ipv4ServerCache | undefined;
let ipv6Cache: Ipv6ServerCache | undefined;
let asnCache: AsnServerCache | undefined;
let entityCache: EntityServerCache | undefined;

const entities = (): EntityServerCache => (entityCache ??= new EntityServerCache());

// the routing map for a kind of query
export function getServerCache(queryType: RdapQueryType, query: string): RdapServerCache {
  switch (queryType) {
    case 'domain':
      return (dnsCache ??= new DnsServerCache());
    case 'ip':
      return query.includes(':')
        ? (ipv6Cache ??= new Ipv6ServerCache())
        : (ipv4Cache ??= new Ipv4ServerCache());
    case 'asn':
      return (asnCache ??= new AsnServerCache());
    case 'entity':
      return entities();
    default:
      throw new Error(`Unsupported RDAP query type: ${queryType as string}`);
  }
}

// get the RDAP server from the cache
export function getRdapServerFromCache(queryType: RdapQueryType, query: string): string | null {
  // first try from bootstrapped caches
  // get the cache for the query type
  const serverCache = getServerCache(queryType, query);

  // resolve the server from the appropriate cache
  return serverCache.getServer(query);
}

// the zone above a domain that the bootstrap data has a server for, e.g. its TLD
export function getRdapZone(domain: string): string | null {
  return (dnsCache ??= new DnsServerCache()).zone(domain);
}

// the zones below a TLD that have an RDAP server of their own
export function getRdapSubZones(): string[] {
  return (dnsCache ??= new DnsServerCache()).subZones();
}

/**
 * the service provider tags IANA's object-tags file knows (the "ARIN" in "NET-ARIN"), each
 * with the RDAP server for handles carrying it
 */
export function getRdapEntityTags(): [string, string][] {
  return entities().entries();
}

/** get the server type, e.g. iana, registry, registrar */
export function getServerType(
  queryType: RdapQueryType,
  query: string,
  server: string
): RdapServerType {
  // normalize server
  server = normalizeRdapServer(server);

  // empty: unknown server type
  if (!server) {
    return UNKNOWN_SERVER_TYPE;
  }

  // rdap.iana.org
  if (server.includes('iana.org')) {
    return IANA_SERVER_TYPE;
  }

  // RIR rdap servers, i.e. ARIN, RIPE, APNIC, LACNIC, AFRINIC
  if (Object.values<string>(RDAP_REGIONAL_REGISTRIES).includes(server)) {
    return REGIONAL_SERVER_TYPE;
  }

  // NOTE: this could check all caches if performant enough
  // get the cache for the query type
  const serverCache = getServerCache(queryType, query);

  // check if the server exists in the registry cache
  if (serverCache.hasServer(server)) {
    return REGISTRY_SERVER_TYPE;
  }

  // a server the bootstrap data does not know, such as a registrar a registry linked to. It
  // may refer on, but its "no such name" is not the registry's
  return UNKNOWN_SERVER_TYPE;
}

/** the RDAP server to ask for a query, as a base URL, or null when none is known */
export function getRdapServer(queryType: RdapQueryType, query: string): string | null {
  // a bare TLD is IANA's to answer
  if (queryType === DOMAIN_QUERY_TYPE && !query.includes('.')) {
    return IANA_RDAP_SERVER;
  }
  // IANA's bootstrap data: by TLD for a domain, by range for an IP address or AS number, and
  // by the handle's tag (the "-ARIN" of "NET-ARIN") for an entity. Anything it does not
  // place has no server, rather than a guess
  return getRdapServerFromCache(queryType, query);
}
