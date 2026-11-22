// The shapes of RDAP responses (RFC 9083) and of the server lookup tables.
import {
  RDAP_DOMAIN_OBJECT_CLASS,
  RDAP_ENTITY_OBJECT_CLASS,
  RDAP_IP_NETWORK_OBJECT_CLASS,
  RDAP_AUT_NUM_OBJECT_CLASS,
  RDAP_NAMESERVER_OBJECT_CLASS,
  RDAP_OBJECT_CLASSES,
  RDAP_ENTITY_ROLES,
  RDAP_SERVER_TYPES,
  RDAP_QUERY_TYPES,
} from './constants';

// the RDAP server types, same as base server types
export type RdapServerType = (typeof RDAP_SERVER_TYPES)[number];

// rdap query type
export type RdapQueryType = (typeof RDAP_QUERY_TYPES)[number];

export interface ServerCacheBootstrap {
  description: string;
  publication: string;
  services: string[][][];
  version: string;
}

export interface RdapServerCache {
  bootstrap: ServerCacheBootstrap;
  cache: Map<string, string>;

  initCache(): void;
  entries(): [string, string][];
  getServer(query: string): string | null;
  allServers(): string[];
  hasServer(server: string): boolean;
}

// parsed/simplified vCard object, used to represent complex vCard objects
export type RdapVcardSimple = {
  version: string; // 'version' field, required
  name?: string; // 'fn' (full name) field, required
  kind?: string; // 'kind' field
  org?: string; // 'org' field (primary organization name)
  orgRole?: string; // 'role' field (preferred role), DIFFERENT FROM ENTITY ROLE, e.g. "Technical Contact"
  orgTitle?: string; // 'title' field (preferred title)
  email?: string; // Preferred email address
  phone?: string; // Preferred telephone number, or the first one with 'voice' type
  fax?: string; // Preferred fax number, or the first one with 'fax' type
  address?: string[]; // combined address lines (PO Box, Extended, Street)
  city?: string; // city or town (Locality)
  state?: string; // state, province, or region
  postalCode?: string; // postal or ZIP code
  countryCode?: string; // full country name
  lang?: string; // Preferred 'lang' field
  contactUri?: string; // Preferred 'contact-uri' field
  url?: string; // Preferred 'url' field
};

// object classes
export type RdapDomainObjectClass = typeof RDAP_DOMAIN_OBJECT_CLASS;
export type RdapEntityObjectClass = typeof RDAP_ENTITY_OBJECT_CLASS;
export type RdapIpNetworkObjectClass = typeof RDAP_IP_NETWORK_OBJECT_CLASS;
export type RdapAutNumObjectClass = typeof RDAP_AUT_NUM_OBJECT_CLASS;
export type RdapNameserverObjectClass = typeof RDAP_NAMESERVER_OBJECT_CLASS;

// union of all object classes
export type RdapObjectClass = (typeof RDAP_OBJECT_CLASSES)[number];

export interface RdapLink {
  value: string;
  rel: string;
  href: string;
  hreflang?: string[];
  type?: string;
  media?: string;
  title?: string;
}

export interface RdapEvent {
  eventAction: string;
  eventActor?: string;
  eventDate: string;
  links?: RdapLink[];
}

export interface RdapPublicID {
  type: string;
  identifier: string;
}

export type RdapStatus =
  | 'validated'
  | 'renew prohibited'
  | 'update prohibited'
  | 'transfer prohibited'
  | 'delete prohibited'
  | 'proxy'
  | 'private'
  | 'removed'
  | 'obscured'
  | 'associated'
  | 'active'
  | 'inactive'
  | 'locked'
  | 'pending create'
  | 'pending renew'
  | 'pending transfer'
  | 'pending update'
  | 'pending delete';

export type RdapNoticeAndRemarkTypes =
  | 'result set truncated due to authorization'
  | 'result set truncated due to excessive load'
  | 'result set truncated due to unexplainable reasons'
  | 'object truncated due to authorization'
  | 'object truncated due to excessive load'
  | 'object truncated due to unexplainable reasons';

export interface RdapRemark {
  title?: string;
  type?: RdapNoticeAndRemarkTypes;
  description: string[];
  links?: RdapLink[];
}

export interface RdapDsData {
  keyTag?: number;
  algorithm?: number;
  digest?: string;
  digestType?: string;
  events?: RdapEvent[];
  links?: RdapLink[];
}

export interface RdapKeyData {
  flags?: number;
  protocol?: number;
  publicKey?: string;
  algorithm?: number;
  events?: RdapEvent[];
  links?: RdapLink[];
}

export interface RdapSecureDNS {
  zoneSigned?: boolean;
  delegationSigned?: boolean;
  maxSigLife?: number;
  dsData?: RdapDsData[];
  keyData?: RdapKeyData[];
}

export type RdapNotice = RdapRemark;

// common fields for all RDAP objects
export interface RdapBaseObject {
  objectClassName: RdapObjectClass;
  handle?: string;
  publicIds?: RdapPublicID[];
  status?: RdapStatus[];
  entities?: RdapEntityObject[];
  links?: RdapLink[];
  remarks?: RdapRemark[];
  notices?: RdapNotice[];
  events?: RdapEvent[];
  port43?: string;
}

// type for RDAP entity roles
export type RdapEntityRole = keyof typeof RDAP_ENTITY_ROLES;

export interface RdapEntityObject extends RdapBaseObject {
  objectClassName: RdapEntityObjectClass;
  vcardArray?: unknown[];
  roles?: RdapEntityRole[];
  asEventActor?: Omit<RdapEvent, 'eventActor'>[];
  networks?: RdapIPNetworkObject[];
  autnums?: RdapAutNumObject[];
}

export interface RdapNameserverObject extends RdapBaseObject {
  objectClassName: RdapNameserverObjectClass;
  ldhName?: string;
  unicodeName?: string;
  ipAddresses?: {
    v6: string[];
    v4: string[];
  };
}

export interface RdapDomainObject extends RdapBaseObject {
  objectClassName: RdapDomainObjectClass;
  ldhName?: string;
  unicodeName?: string;
  variants: {
    relation: string[];
    idnTable: string;
    variantNames: {
      ldhName: string;
      unicodeName: string;
    }[];
  }[];
  nameservers: RdapNameserverObject[];
  secureDNS: RdapSecureDNS;
  network?: RdapIPNetworkObject;
}

export interface RdapIPNetworkObject extends RdapBaseObject {
  objectClassName: RdapIpNetworkObjectClass;
  startAddress?: string;
  endAddress?: string;
  ipVersion?: 'v4' | 'v6';
  name?: string;
  type?: string;
  country?: string;
  parentHandle?: string;
}

export interface RdapAutNumObject extends RdapBaseObject {
  objectClassName: RdapAutNumObjectClass;
  startAutnum?: string;
  endAutnum?: string;
  name?: string;
  type?: string;
  country?: string;
}

// base type with all shared optional fields
type RdapBaseResponse = {
  notices?: RdapNotice[];
  title?: string; // error title
  description?: string[]; // error description
};

// errorCode required, rdapConformance optional
export type RdapErrorResponse = RdapBaseResponse & {
  rdapConformance?: string[];
  errorCode: number;
};

// rdapConformance required, errorCode optional
export type RdapCommonResponse = RdapBaseResponse & {
  rdapConformance: string[];
  errorCode: never;
};

// export type BaseRdapResponse = RdapCommonResponse & RdapErrorResponse;

// Search response types
// export interface RdapSearchResultSet {
//   domainSearchResults?: RdapDomainObjectClass[];
//   nameserverSearchResults?: RdapNameserverObjectClass[];
//   entitySearchResults?: RdapEntityObjectClass[];
// }

export type RdapDomainSearchResponse = RdapCommonResponse & {
  domainSearchResults: RdapDomainObject[];
};

export type RdapNameserverSearchResponse = RdapCommonResponse & {
  nameserverSearchResults: RdapNameserverObject[];
};

export type RdapEntitySearchResponse = RdapCommonResponse & {
  entitySearchResults: RdapEntityObject[];
};

export type RdapDomainResponse = RdapCommonResponse & RdapDomainObject;
export type RdapIpResponse = RdapCommonResponse & RdapIPNetworkObject;
export type RdapAsnResponse = RdapCommonResponse & RdapAutNumObject;
export type RdapEntityResponse = RdapCommonResponse & RdapEntityObject;
export type RdapNameserverResponse = RdapCommonResponse & RdapNameserverObject;
export type RdapHelpResponse = RdapCommonResponse;

// could do it like this instead, but that means adding queryType to the response
// export type RdapDomainResponse = RdapCommonResponse &
//   RdapDomainObject & {
//     readonly queryType: 'domain';
//   };
// export type RdapIpResponse = RdapCommonResponse &
//   RdapIPNetworkObject & {
//     readonly queryType: 'ip';
//   };

// pass the object class to get a specific response type
export type RdapObjectResponse<O extends RdapObjectClass = RdapObjectClass> = {
  [C in RdapObjectClass]: Extract<
    | RdapDomainResponse
    | RdapIpResponse
    | RdapAsnResponse
    | RdapEntityResponse
    | RdapNameserverResponse,
    { objectClassName: C }
  >;
}[O];

export type RdapResponse<O extends RdapObjectClass = RdapObjectClass> =
  RdapErrorResponse | RdapCommonResponse | RdapObjectResponse<O>;

// this is not used
// export interface RdapQuery {
//   query: string;
//   queryType: RdapQueryType;
//   server?: string;
//   serverType?: RdapServerType;
//   url?: string;
// }
