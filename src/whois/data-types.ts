// The data a WHOIS response is parsed into, and the types the parser is configured with.
import type { QueryType, ServerType } from '../common/constants';
import type { EppStatus } from '../record/epp';

// how to ask one WHOIS server, and how to read its answer
export type WhoisServer = {
  host: string;
  serverType: WhoisServerType;
  // the line to send, with $query for the query, when it is not the query alone
  queryString?: string;
  // the line to send for each kind of query, ahead of queryString
  queryTypes?: {
    [key in WhoisQueryType]?: string;
  };
  // the character encoding the server answers in, as TextDecoder names it, when it is not
  // UTF-8
  encoding?: string;
};

export type ParserOptions = {
  /** date format configuration */
  dayFirst?: boolean;
};

export type FieldFormatter<T extends WhoisValue = WhoisValue> = (
  value: WhoisValue,
  field?: string,
  queryType?: WhoisQueryType,
  options?: ParserOptions
) => T;

// all possible values for a whois field
export type WhoisValue = number | boolean | string | string[] | Date | null | undefined;

/** the WHOIS server types, same as base server types */
export type WhoisServerType = ServerType;

/** whois query type */
export type WhoisQueryType = QueryType;

// for handling parsed fields without worrying about the type
export interface WhoisDataBag {
  [key: string]: WhoisValue;
}

/**
 * parsed whois data, by kind of query. Not-found, throttled and reserved are not fields:
 * the parser reports them as the response's status
 */
export type WhoisDataType = WhoisDomainData | WhoisIpData | WhoisAsnData | WhoisEntityData;

// The parsed data is parser output: every field is present, and null when the response did
// not give it. Its shape may change in any 0.x release; the domain record is the stable one

/** parsed IP fields */
export interface WhoisIpData {
  ipId: string | null;
  ipAddress: string | null;
}

/** parsed ASN fields */
export interface WhoisAsnData {
  asnId: string | null;
  asnName: string | null;
}

/** parsed Entity fields */
export interface WhoisEntityData {
  entityId: string | null;
  entityName: string | null;
}

/** parsed domain fields */
export interface WhoisDomainData {
  // Domain fields
  domainId: string | null;
  domainName: string | null;
  creationDate: Date | null;
  expirationDate: Date | null;
  /**
   * the registrar's expiry when the response gives it under its own name ("Registrar
   * Registration Expiration Date"), which a registry may pass on beside its own
   */
  registrarExpirationDate: Date | null;
  updatedDate: Date | null;
  /** the statuses that map to EPP codes */
  eppStatus: EppStatus[] | null;
  /** every status value as the server wrote it, mapped or not */
  eppStatusRaw: string[] | null;
  nameservers: string[] | null;
  /** whether the domain is signed, or null when the response does not say in words that map */
  dnssec: boolean | null;
  /** the DNSSEC value as the server wrote it */
  dnssecRaw: string | null;

  // Registrar fields
  /** the registrar's identifier as the server wrote it: an IANA ID or a registry's own handle */
  registrarId: string | null;
  /** the registrar's IANA ID, when registrarId is one */
  registrarIanaId: number | null;
  registrarName: string | null;
  registrarOrg: string | null;
  registrarReseller: string | null;
  registrarAddress: string[] | null;
  registrarCity: string | null;
  registrarState: string | null;
  registrarPostalCode: string | null;
  registrarCountry: string | null;
  registrarPhone: string | null;
  registrarPhoneExt: string | null;
  registrarFax: string | null;
  registrarFaxExt: string | null;
  registrarEmail: string | null;
  registrarUrl: string | null;
  registrarAbuseEmail: string | null;
  registrarAbusePhone: string | null;
  registrarWhoisServer: string | null;

  // Registrant contact
  registrantId: string | null;
  registrantName: string | null;
  registrantOrg: string | null;
  registrantAddress: string[] | null;
  registrantCity: string | null;
  registrantState: string | null;
  registrantPostalCode: string | null;
  registrantCountry: string | null;
  registrantPhone: string | null;
  registrantPhoneExt: string | null;
  registrantFax: string | null;
  registrantFaxExt: string | null;
  registrantEmail: string | null;

  // Administrative contact
  adminId: string | null;
  adminName: string | null;
  adminOrg: string | null;
  adminAddress: string[] | null;
  adminCity: string | null;
  adminState: string | null;
  adminPostalCode: string | null;
  adminCountry: string | null;
  adminPhone: string | null;
  adminPhoneExt: string | null;
  adminFax: string | null;
  adminFaxExt: string | null;
  adminEmail: string | null;

  // Technical contact
  techId: string | null;
  techName: string | null;
  techOrg: string | null;
  techAddress: string[] | null;
  techCity: string | null;
  techState: string | null;
  techPostalCode: string | null;
  techCountry: string | null;
  techPhone: string | null;
  techPhoneExt: string | null;
  techFax: string | null;
  techFaxExt: string | null;
  techEmail: string | null;

  // Billing contact
  billingId: string | null;
  billingName: string | null;
  billingOrg: string | null;
  billingAddress: string[] | null;
  billingCity: string | null;
  billingState: string | null;
  billingPostalCode: string | null;
  billingCountry: string | null;
  billingPhone: string | null;
  billingPhoneExt: string | null;
  billingFax: string | null;
  billingFaxExt: string | null;
  billingEmail: string | null;
}
