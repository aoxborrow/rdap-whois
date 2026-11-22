// The normalized domain record: one shape for what RDAP and WHOIS say about a domain.
import { DOMAIN_CONTACT_TYPES } from './constants';
import type { CountryCode } from './countries';
import type { EppStatus } from './epp';

export type { EppStatus };

export type DomainContactType = (typeof DOMAIN_CONTACT_TYPES)[number];

/** a contact on the record: registrant, admin, tech or billing */
export interface DomainContact {
  /** the contact's handle at the registry or registrar */
  id: string | null;
  /** the contact's name, or the organization's when no person is named */
  name: string | null;
  /** the organization, when it differs from `name` */
  org: string | null;
  address: string[] | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  countryCode: CountryCode | null;
  phone: string | null;
  phoneExt: string | null;
  fax: string | null;
  faxExt: string | null;
  /** an email address, never a URL */
  email: string | null;
  /** the contact's contact-uri, else a contact URL that is not an email address */
  url: string | null;
}

export interface DomainRegistrar {
  /** the registrar's IANA ID */
  ianaId: number | null;
  /** the registrar's name */
  name: string | null;
  address: string[] | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  countryCode: CountryCode | null;
  phone: string | null;
  phoneExt: string | null;
  fax: string | null;
  faxExt: string | null;
  /** an email address, never a URL */
  email: string | null;
  /** the registrar's website, else its contact URL */
  url: string | null;
  abuseEmail: string | null;
  abusePhone: string | null;
}

/** a domain's registration data, as the record holds it */
export interface DomainData {
  /** the domain in ASCII (punycode for an IDN) */
  domainName: string;
  /** the domain in Unicode when it is an IDN, otherwise null */
  domainNameUnicode: string | null;
  creationDate: Date | null;
  expirationDate: Date | null;
  updatedDate: Date | null;
  /** [] when the server gave none */
  nameservers: string[];
  /** whether the domain has DNSSEC enabled; null when the server did not say */
  dnssec: boolean | null;
  /** validated EPP codes only; [] when none */
  eppStatus: EppStatus[];
  /**
   * the statuses the server gave that map to no EPP code, as it wrote them: a registry's own
   * vocabulary (`connect` at DENIC), or RDAP wording that could be either of two codes
   */
  unmappedStatus: string[];

  /** the registry itself said the name does not exist, so it can be registered */
  available: boolean;
  /** the registry holds the name back from registration; never true with `available` */
  reserved: boolean;

  // registrar
  registrar: DomainRegistrar | null;

  // contacts
  registrant: DomainContact | null;
  admin: DomainContact | null;
  tech: DomainContact | null;
  billing: DomainContact | null;
}
