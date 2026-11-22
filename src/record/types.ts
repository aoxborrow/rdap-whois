// The normalized domain record: one shape for what RDAP and WHOIS say about a domain.
import { DOMAIN_CONTACT_TYPES } from './constants';
import type { CountryCode } from './countries';
import type { EppStatus } from './epp';

export type { EppStatus };

export type DomainContactType = (typeof DOMAIN_CONTACT_TYPES)[number];

// shared contact shape
export interface DomainContact {
  id: string | null; // entity handle in WHOIS/RDAP
  name: string | null; // contact name or organization name
  org: string | null; // organization name, only present if different from name
  address: string[] | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  countryCode: CountryCode | null;
  phone: string | null;
  phoneExt: string | null;
  fax: string | null;
  faxExt: string | null;
  email: string | null; // only put emails here, no URLs
  url: string | null; // use contact-uri, or contact URLs if they're not an email
}

export interface DomainRegistrar {
  ianaId: number | null; // IANA ID as number
  name: string | null; // registrar name
  address: string[] | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  countryCode: CountryCode | null;
  phone: string | null;
  phoneExt: string | null;
  fax: string | null;
  faxExt: string | null;
  email: string | null; // only put emails here, no URLs
  url: string | null; // the registrar website, or fallback to contact-uri
  abuseEmail: string | null;
  abusePhone: string | null;
}

// core domain fields
export interface DomainData {
  domainName: string; // the domain in punycode/ASCII
  domainNameUnicode: string | null; // the IDN domain in full unicode if IDN, otherwise null
  creationDate: Date | null;
  expirationDate: Date | null;
  updatedDate: Date | null;
  nameservers: string[]; // [] when the server gave none
  dnssec: boolean | null; // whether the domain has DNSSEC enabled; null when the server did not say
  eppStatus: EppStatus[]; // validated EPP codes only; [] when none
  // the statuses the server gave that map to no EPP code, as it wrote them: a registry's own
  // vocabulary (`connect` at DENIC), or RDAP wording that could be either of two codes
  unmappedStatus: string[];

  // the registry itself said the name does not exist, so it can be registered
  available: boolean;
  // the registry holds the name back from registration; never true with `available`
  reserved: boolean;

  // registrar
  registrar: DomainRegistrar | null;

  // contacts
  registrant: DomainContact | null;
  admin: DomainContact | null;
  tech: DomainContact | null;
  billing: DomainContact | null;
}
