import { QUERY_TYPES, SERVER_TYPES } from '../common/constants';

// same as default query types for now, save this for easy updating
export const RDAP_QUERY_TYPES = QUERY_TYPES;

// same as base server types
export const RDAP_SERVER_TYPES = SERVER_TYPES;

// objectClassName in RDAP responses
export const RDAP_DOMAIN_OBJECT_CLASS = 'domain';
export const RDAP_ENTITY_OBJECT_CLASS = 'entity';
export const RDAP_IP_NETWORK_OBJECT_CLASS = 'ip network';
export const RDAP_AUT_NUM_OBJECT_CLASS = 'autnum';
export const RDAP_NAMESERVER_OBJECT_CLASS = 'nameserver';

// all objectClasses in RDAP responses
export const RDAP_OBJECT_CLASSES = [
  RDAP_DOMAIN_OBJECT_CLASS,
  RDAP_ENTITY_OBJECT_CLASS,
  RDAP_IP_NETWORK_OBJECT_CLASS,
  RDAP_AUT_NUM_OBJECT_CLASS,
  RDAP_NAMESERVER_OBJECT_CLASS,
] as const;

// IANA rdap server, default for TLDs
export const IANA_RDAP_SERVER = 'https://rdap.iana.org/';

// the regional internet registries' RDAP servers, by registry
export const RDAP_REGIONAL_REGISTRIES = {
  ARIN: 'https://rdap.arin.net/registry/',
  RIPE: 'https://rdap.db.ripe.net/',
  APNIC: 'https://rdap.apnic.net/',
  LACNIC: 'https://rdap.lacnic.net/rdap/',
  AFRINIC: 'https://rdap.afrinic.net/rdap/',
} as const;

// all entity roles in RDAP responses
export const RDAP_ENTITY_ROLES = {
  registrar: 'Registrar',
  reseller: 'Reseller',
  sponsor: 'Sponsor',
  proxy: 'Proxy',
  registrant: 'Registrant',
  administrative: 'Administrative',
  technical: 'Technical',
  billing: 'Billing',
  abuse: 'Abuse',
  notifications: 'Notify',
  noc: 'NOC',
} as const;
