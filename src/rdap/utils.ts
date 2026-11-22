import {
  RDAP_DOMAIN_OBJECT_CLASS,
  RDAP_IP_NETWORK_OBJECT_CLASS,
  RDAP_ENTITY_OBJECT_CLASS,
  RDAP_OBJECT_CLASSES,
  RDAP_ENTITY_ROLES,
  RDAP_AUT_NUM_OBJECT_CLASS,
  RDAP_NAMESERVER_OBJECT_CLASS,
} from './constants';
import {
  ASN_QUERY_TYPE,
  DOMAIN_QUERY_TYPE,
  ENTITY_QUERY_TYPE,
  IP_QUERY_TYPE,
} from '../common/constants';
import { titleCase } from '../common/values';
import {
  RdapAsnResponse,
  RdapCommonResponse,
  RdapDomainResponse,
  RdapEntityObject,
  RdapEntityResponse,
  RdapEntityRole,
  RdapErrorResponse,
  RdapEvent,
  RdapIpResponse,
  RdapLink,
  RdapNameserverResponse,
  RdapObjectClass,
  RdapObjectResponse,
  RdapQueryType,
  RdapResponse,
} from './types';

// Interface for unknown RDAP response input
interface RdapResponseInput {
  errorCode?: number;
  rdapConformance?: unknown[];
  objectClassName?: string;
}

export const stripRdapEndpoint = (url: string): string => {
  if (!url) return '';

  const endpoints = ['/domain/', '/ip/', '/autnum/', '/entity/'];
  url = String(url).toLowerCase();

  // Find the first occurrence of any endpoint in the URL
  let endpointIndex = -1;
  for (const endpoint of endpoints) {
    const index = url.indexOf(endpoint);
    if (index !== -1 && (endpointIndex === -1 || index < endpointIndex)) {
      endpointIndex = index;
    }
  }
  // Return the stripped URL, or the full URL if no endpoint found
  return endpointIndex !== -1 ? url.substring(0, endpointIndex) : url;
};

/** an RDAP server's base URL in one form: lower case, https, no query path, one trailing slash */
export const normalizeRdapServer = (server: string): string => {
  if (!server) return '';
  server = String(server).toLowerCase();

  // remove any existing endpoint paths (and anything that follow), e.g. /domain/one.com
  let normalizedServer = stripRdapEndpoint(server);

  // replace HTTP with HTTPS if needed
  if (normalizedServer.startsWith('http://')) {
    normalizedServer = 'https://' + normalizedServer.substring(7);
  }

  // add HTTPS if no protocol is specified
  if (!normalizedServer.startsWith('http')) {
    normalizedServer = 'https://' + normalizedServer;
  }

  // ensure exactly one trailing slash
  normalizedServer = normalizedServer.replace(/\/+$/, ''); // remove all trailing slashes
  normalizedServer += '/'; // add one trailing slash

  // lowercase the URL
  return normalizedServer.toLowerCase();
};

/**
 * build the RDAP query path for given query and queryType
 * only IP and ASN are different
 */
export function getRdapQueryPath(queryType: RdapQueryType, query: string): string {
  switch (queryType) {
    case DOMAIN_QUERY_TYPE:
      return `domain/${query}`;
    case IP_QUERY_TYPE:
      return `ip/${query}`;
    case ASN_QUERY_TYPE:
      return `autnum/${query}`;
    case ENTITY_QUERY_TYPE:
      return `entity/${query}`;
    // case NAMESERVER_QUERY_TYPE:
    //   return `nameserver/${query}`;
    default:
      throw new Error(`Unsupported RDAP query type: ${queryType as string}`);
  }
}

/** type guards for different RDAP response types */
export function isRdapResponse(r: unknown): r is RdapResponse {
  const input = r as RdapResponseInput;
  return (
    typeof r === 'object' &&
    r !== null &&
    (typeof input.errorCode === 'number' ||
      (Array.isArray(input.rdapConformance) && input.rdapConformance.length > 0))
  );
}

export function isErrorResponse(r: RdapResponse): r is RdapErrorResponse {
  return isRdapResponse(r) && typeof r.errorCode === 'number';
}

export function isCommonResponse(r: RdapResponse): r is RdapCommonResponse {
  const input = r as RdapResponseInput;
  return (
    isRdapResponse(r) &&
    Array.isArray(input.rdapConformance) &&
    input.rdapConformance.every((v: unknown) => typeof v === 'string') &&
    typeof input.errorCode === 'undefined'
  );
}

export function isObjectResponse(r: RdapResponse): r is RdapObjectResponse {
  const input = r as RdapResponseInput;
  return (
    isCommonResponse(r) &&
    Object.keys(r).includes('objectClassName') &&
    typeof input.objectClassName === 'string' &&
    RDAP_OBJECT_CLASSES.includes(input.objectClassName as (typeof RDAP_OBJECT_CLASSES)[number])
  );
}

export const isDomainResponse = (r: RdapResponse): r is RdapDomainResponse => {
  return isObjectResponse(r) && r.objectClassName === RDAP_DOMAIN_OBJECT_CLASS;
};

export const isIpResponse = (r: RdapResponse): r is RdapIpResponse => {
  return isObjectResponse(r) && r.objectClassName === RDAP_IP_NETWORK_OBJECT_CLASS;
};

export const isAsnResponse = (r: RdapResponse): r is RdapAsnResponse => {
  return isObjectResponse(r) && r.objectClassName === RDAP_AUT_NUM_OBJECT_CLASS;
};

export const isEntityResponse = (r: RdapResponse): r is RdapEntityResponse => {
  return isObjectResponse(r) && r.objectClassName === RDAP_ENTITY_OBJECT_CLASS;
};

export const isNameserverResponse = (r: RdapResponse): r is RdapNameserverResponse => {
  return isObjectResponse(r) && r.objectClassName === RDAP_NAMESERVER_OBJECT_CLASS;
};

/** helper function to find entity by role */
export const findEntitiesByRole = (
  entities: RdapEntityObject[] | undefined,
  role: RdapEntityRole
): RdapEntityObject[] => {
  if (!entities) return [];
  return entities.filter(entity => entity.roles?.includes(role));
};

/** gather all entities by their roles into a map */
export const gatherEntitiesByRole = (
  entities: RdapEntityObject[] | undefined
): Record<RdapEntityRole, RdapEntityObject[]> => {
  if (!entities) return {} as Record<RdapEntityRole, RdapEntityObject[]>;

  return Object.keys(RDAP_ENTITY_ROLES).reduce(
    (acc, role) => {
      const entitiesWithRole = entities.filter(entity =>
        entity.roles?.includes(role as RdapEntityRole)
      );
      if (entitiesWithRole.length > 0) {
        acc[role as RdapEntityRole] = entitiesWithRole;
      }
      return acc;
    },
    {} as Record<RdapEntityRole, RdapEntityObject[]>
  );
};

/** helper function to find events by action */
export const findEventByAction = (
  events: RdapEvent[] | undefined,
  action: string
): RdapEvent | undefined => {
  if (!events) return undefined;
  return events.find(event => event.eventAction === action);
};

/** helper function to find links by rel */
export const findLinkByRel = (links: RdapLink[] | undefined, rel: string): RdapLink | undefined => {
  if (!links) return undefined;
  return links.find(link => link.rel === rel);
};

/** get the EPP status from the RDAP status string */
export const rdapGetEppStatus = (status: string): string | null => {
  return status in RDAP_EPP_STATUS_MAP ? RDAP_EPP_STATUS_MAP[status] : null;
};

export const RDAP_EPP_STATUS_MAP: Record<string, string> = {
  'active': 'ok',
  'add period': 'addPeriod',
  'associated': 'linked',
  'auto renew period': 'autoRenewPeriod',
  'client delete prohibited': 'clientDeleteProhibited',
  'client hold': 'clientHold',
  'client renew prohibited': 'clientRenewProhibited',
  'client transfer prohibited': 'clientTransferProhibited',
  'client update prohibited': 'clientUpdateProhibited',
  'inactive': 'inactive',
  // 'locked': null,
  // 'obscured': null,
  'pending create': 'pendingCreate',
  'pending delete': 'pendingDelete',
  'pending renew': 'pendingRenew',
  'pending restore': 'pendingRestore',
  'pending transfer': 'pendingTransfer',
  'pending update': 'pendingUpdate',
  // 'private': null,
  // 'proxy': null,
  'redemption period': 'redemptionPeriod',
  // 'removed': null,
  'renew period': 'renewPeriod',
  'server delete prohibited': 'serverDeleteProhibited',
  'server hold': 'serverHold',
  'server renew prohibited': 'serverRenewProhibited',
  'server transfer prohibited': 'serverTransferProhibited',
  'server update prohibited': 'serverUpdateProhibited',
  'transfer period': 'transferPeriod',
  // the UNQUALIFIED forms ('delete prohibited', 'renew prohibited', 'transfer prohibited',
  // 'update prohibited') are deliberately absent. they used to point at the client* codes on
  // a guess, but RFC 8056 is explicit that the RDAP prohibited statuses "do not directly map
  // to the EPP prohibited statuses", because client* is a lock the registrar set and can lift
  // while server* is a registry lock it cannot — a distinction RDAP "needs to preserve".
  // guessing client* tells a caller a lock is liftable when it may not be, so these now fall
  // through and get dropped from the normalized domain view instead
  // 'validated': null,
};
