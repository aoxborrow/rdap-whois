// WHOIS server ROUTING: which host answers for a query, how to ask it, and what kind of
// server it is. The ./servers/ directory beside it is unrelated: it is per-host PARSE data,
// reached via formatConfig() in ./formats.
import { TLD_SERVERS } from './generated/tlds';
import {
  DOMAIN_QUERY_TYPE,
  UNKNOWN_SERVER_TYPE,
  IANA_SERVER_TYPE,
  REGIONAL_SERVER_TYPE,
  REGISTRY_SERVER_TYPE,
} from '../common/constants';
import { normalizeDomain, normalizeServer } from '../common/utils';
import { parseField, whoisServerFormatter } from './base';
import {
  IANA_WHOIS_SERVER,
  SPECIAL_SERVERS,
  WHOIS_REGIONAL_REGISTRIES,
  WHOIS_SERVER_ENCODINGS,
  resolveServerAlias,
} from './constants';
import { WhoisQueryType, WhoisServer, WhoisServerType } from './data-types';
import { normalizeRawText } from './raw-text';

// get server config
export function getServerConfig(host: string): WhoisServer {
  // normalize whois server, then resolve legacy aliases (e.g. dk-hostmaster → punktum)
  // so a caller passing the old hostname still gets its special query string + parser
  host = resolveServerAlias(normalizeServer(host));

  const encoding = WHOIS_SERVER_ENCODINGS[host];
  // a server asked in a way of its own: the query string it needs, or its type
  const specialServer = SPECIAL_SERVERS.find(s => s.host === host);
  const config = specialServer ?? { host, serverType: getServerType(host) };
  return encoding ? { ...config, encoding } : config;
}

/**
 * the type of a WHOIS server as the client reports it on a hop: from the routing data, with
 * a renamed host resolved to its current name
 */
export function getWhoisServerType(host: string): WhoisServerType {
  return getServerConfig(host).serverType;
}

// get the query string to send to the WHOIS server
export function getQueryString(
  serverConfig: WhoisServer,
  query: string,
  queryType: WhoisQueryType
): string {
  let queryString = '$query';
  // use correct queryString for the queryType if defined
  if (serverConfig.queryTypes && serverConfig.queryTypes[queryType]) {
    queryString = serverConfig.queryTypes[queryType];
  } else if (serverConfig.queryString) {
    // use the custom server queryString if defined
    queryString = serverConfig.queryString;
  }
  // replace the $query placeholder with the actual query
  return queryString.replace('$query', query);
}

// get the whois server for a given domain
export function getTldServer(domain: string): string | null {
  // normalize server
  domain = normalizeDomain(domain);

  // if the domain is empty, return null
  if (!domain) {
    return null;
  }
  // if it's a bare TLD, use the default IANA server
  if (!domain.includes('.')) {
    return IANA_WHOIS_SERVER;
  }
  const zone = getTldZone(domain);
  return zone === null ? null : TLD_SERVERS[zone];
}

// the zone above a domain that has a WHOIS server: the longest one, starting below the name
// itself (a null entry means the zone has no server, and the search goes on above it)
export function getTldZone(domain: string): string | null {
  domain = normalizeDomain(domain);
  while (domain.includes('.')) {
    domain = domain.substring(domain.indexOf('.') + 1);
    if (TLD_SERVERS[domain]) return domain;
  }
  return null;
}

/** determines the appropriate WHOIS server for a given query */
export function getWhoisServer(queryType: WhoisQueryType, query: string): string | null {
  // an IP address, AS number or handle goes to IANA, which refers to the regional registry
  // that holds it
  if (queryType !== DOMAIN_QUERY_TYPE) {
    return IANA_WHOIS_SERVER;
  }

  // attempt to find matching TLD registry server
  // iterate starting with the longest TLD, removing labels until we find a match
  // (a null entry means the TLD has no WHOIS server, as IANA's own record for it says)
  const host = getTldServer(query);
  if (host) {
    return host;
  }

  // a TLD the table lists with no server has none: IANA would answer with the TLD's own
  // record (its creation date, its DS), which reads as the domain's
  const tld = normalizeDomain(query).split('.').pop() ?? '';
  if (Object.hasOwn(TLD_SERVERS, tld)) {
    return null;
  }

  // fallback for TLDs the table does not list: IANA only describes the TLD itself, but its
  // response carries a `whois:` referral when one exists — trying it beats returning
  // nothing
  return IANA_WHOIS_SERVER;
}

// every host the TLD table names, built the first time a server's type is asked
let registryHosts: Set<string> | undefined;
function registryServers(): Set<string> {
  return (registryHosts ??= new Set(
    Object.values(TLD_SERVERS).filter((host): host is string => !!host)
  ));
}

// get the server type, e.g. iana, registry, registrar
export function getServerType(server: string): WhoisServerType {
  server = normalizeServer(server);

  // empty: unknown server type
  if (!server) {
    return UNKNOWN_SERVER_TYPE;
  }

  // whois.iana.org
  if (server.includes('iana.org')) {
    return IANA_SERVER_TYPE;
  }

  // RIR WHOIS servers, i.e. ARIN, RIPE, APNIC, LACNIC, AFRINIC
  if (Object.values<string>(WHOIS_REGIONAL_REGISTRIES).includes(server)) {
    return REGIONAL_SERVER_TYPE;
  }

  // a server the TLD table names for some TLD
  if (registryServers().has(server)) {
    return REGISTRY_SERVER_TYPE;
  }

  // a host the routing data does not know, such as a registrar a registry referred to. It
  // may refer on, but its "no such name" is not the registry's
  return UNKNOWN_SERVER_TYPE;
}

// the referral / registrar-whois-server spellings. Following a referral is part of the
// lookup, not of parsing a response's fields, so the pattern lives here
const REFERRAL_SERVER_REGEX =
  '(?:ReferralServer|[Rr]egistrar (?:WHOIS [Ss]erver|[Ww]hois)|[Ww]hois? [Ss]erver|WHOIS [Ss]erver|refer|whois) *:(.*)';

// parses out a referral server from raw WHOIS data
export function parseReferralServer(raw: string | undefined | null): string | null {
  if (!raw) return null;
  // normalize raw text by replacing tabs with spaces and CRLF with LF
  raw = normalizeRawText(raw);
  // parse the whois data for the referral server
  const parsedValue = parseField(REFERRAL_SERVER_REGEX, raw);
  // format the parsed value to a single valid whois server
  return whoisServerFormatter(parsedValue);
}
