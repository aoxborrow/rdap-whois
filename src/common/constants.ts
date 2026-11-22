// What a query is about, and what kind of server answered it.

export const DOMAIN_QUERY_TYPE = 'domain';
export const ASN_QUERY_TYPE = 'asn';
export const IP_QUERY_TYPE = 'ip';
export const ENTITY_QUERY_TYPE = 'entity';

export const QUERY_TYPES = [
  DOMAIN_QUERY_TYPE,
  ASN_QUERY_TYPE,
  IP_QUERY_TYPE,
  ENTITY_QUERY_TYPE,
] as const;

export type QueryType = (typeof QUERY_TYPES)[number];

export const UNKNOWN_SERVER_TYPE = 'unknown';
export const IANA_SERVER_TYPE = 'iana';
export const REGIONAL_SERVER_TYPE = 'regional';
export const REGISTRY_SERVER_TYPE = 'registry';
export const REGISTRAR_SERVER_TYPE = 'registrar';

export const SERVER_TYPES = [
  UNKNOWN_SERVER_TYPE,
  IANA_SERVER_TYPE,
  REGIONAL_SERVER_TYPE,
  REGISTRY_SERVER_TYPE,
  REGISTRAR_SERVER_TYPE,
] as const;

export type ServerType = (typeof SERVER_TYPES)[number];
