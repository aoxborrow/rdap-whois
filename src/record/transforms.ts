import { DomainContactType, DomainData, DomainRegistrar } from './types';
import type { RdapResponse } from '../rdap/types';
import type { WhoisDataType, WhoisDomainData } from '../whois/data-types';
import { findEntitiesByRole, findEventByAction } from '../rdap/utils';
import { parseRdapDate } from '../rdap/validate';
import { cleanArray, cleanNameserver, parseWhoisDnssecValue } from '../whois/utils';
import { cleanString, isIdn, realDate, toAscii, toUnicode } from '../common/utils';
import { parseCountryCode } from './countries';
import {
  parseRdapStatus,
  parseWhoisStatus,
  unmappedRdapStatus,
  unmappedWhoisStatus,
  parseRdapDnssecValue,
  buildWhoisContact,
  rdapEntityToContact,
  rdapEntityToRegistrar,
  registrarHasData,
} from './utils';

// what the transforms read from one server's answer: the query, and the data parsed from it
export interface RdapRecordSource {
  query: string;
  queryType: string;
  data?: RdapResponse;
}
export interface WhoisRecordSource {
  query: string;
  queryType: string;
  data?: WhoisDataType;
  // whether the parser read the response as a name the registry withholds
  reserved?: boolean;
}

// transform rdap domain data to domain data
export function transformRdapDomainData(result: RdapRecordSource): DomainData {
  // ensure we have a domain result
  if (result.queryType !== 'domain' || !result.data) {
    throw new Error('Invalid RdapResult: expected domain query type with data');
  }

  // check if it's a domain object
  if (!('objectClassName' in result.data) || result.data.objectClassName !== 'domain') {
    throw new Error('Invalid RdapResult: expected domain object');
  }

  const rdapData = result.data;

  // parse status values
  const eppStatus = parseRdapStatus(rdapData.status);

  // parse DNSSEC
  const dnssec = parseRdapDnssecValue(rdapData.secureDNS);

  // extract nameservers, cleaned as WHOIS ones are (.uk writes them with a trailing dot)
  const nameservers =
    rdapData.nameservers
      ?.map(ns => cleanNameserver(ns.ldhName || ns.unicodeName))
      .filter((ns): ns is string => Boolean(ns)) ?? [];

  // find entities by role
  const registrarEntity = findEntitiesByRole(rdapData.entities, 'registrar')[0];
  const registrantEntity = findEntitiesByRole(rdapData.entities, 'registrant')[0];
  const adminEntity = findEntitiesByRole(rdapData.entities, 'administrative')[0];
  const techEntity = findEntitiesByRole(rdapData.entities, 'technical')[0];
  const billingEntity = findEntitiesByRole(rdapData.entities, 'billing')[0];

  // transform entities to contacts
  const parsedRegistrar = rdapEntityToRegistrar(registrarEntity);
  const registrar = registrarHasData(parsedRegistrar) ? parsedRegistrar : null;
  const registrant = rdapEntityToContact(registrantEntity, 'registrant');
  const admin = rdapEntityToContact(adminEntity, 'admin');
  const tech = rdapEntityToContact(techEntity, 'tech');
  const billing = rdapEntityToContact(billingEntity, 'billing');

  // extract dates from events
  const registrationEvent = findEventByAction(rdapData.events, 'registration');
  const expirationEvent = findEventByAction(rdapData.events, 'expiration');
  const lastChangedEvent = findEventByAction(rdapData.events, 'last changed');

  const domainName = toAscii(rdapData.ldhName || rdapData.unicodeName || result.query);
  const domainData: DomainData = {
    // core domain fields
    domainName: domainName,
    domainNameUnicode: isIdn(domainName) ? toUnicode(domainName) : null,
    creationDate: realDate(parseRdapDate(registrationEvent?.eventDate)),
    expirationDate: realDate(parseRdapDate(expirationEvent?.eventDate)),
    updatedDate: realDate(parseRdapDate(lastChangedEvent?.eventDate)),
    nameservers,
    dnssec,
    eppStatus: eppStatus ?? [],
    unmappedStatus: unmappedRdapStatus(rdapData.status) ?? [],

    // an RDAP domain object only exists for a registered name — the available/reserved answers
    // arrive as a 404 or an error body, which never reach this transform
    available: false,
    reserved: false,

    // entities
    registrar,
    registrant,
    admin,
    tech,
    billing,
  };

  return domainData;
}

// transform whois domain data to domain data
export function transformWhoisDomainData(result: WhoisRecordSource): DomainData {
  // ensure we have a domain result
  if (result.queryType !== 'domain' || !result.data) {
    throw new Error('Invalid WhoisResult: expected domain query type with data');
  }

  const data = result.data as WhoisDomainData;

  // parse status values
  const eppStatus = parseWhoisStatus(data.eppStatus);

  // DNSSEC, which the parser already read as a yes or no; a value from before it did is text
  const dnssec = parseWhoisDnssecValue(data.dnssec);

  // clean nameservers
  const nameservers =
    data.nameservers?.map(ns => cleanNameserver(ns)).filter((ns): ns is string => ns !== null) ??
    [];

  // the registrar's IANA ID, when its identifier is one
  const ianaId = data.registrarIanaId ?? null;

  // get the main email, but only use it if it's different from abuseEmail
  const mainEmail = cleanString(data.registrarEmail);
  const abuseEmail = cleanString(data.registrarAbuseEmail);
  const registrarEmail = mainEmail && mainEmail !== abuseEmail ? mainEmail : null;

  // parse and validate country code
  const countryCode = parseCountryCode(data.registrarCountry);

  const registrar: DomainRegistrar = {
    ianaId: ianaId,
    name: cleanString(data.registrarName),
    address: cleanArray(data.registrarAddress ?? []),
    city: cleanString(data.registrarCity),
    state: cleanString(data.registrarState),
    postalCode: cleanString(data.registrarPostalCode),
    countryCode: countryCode,
    phone: cleanString(data.registrarPhone),
    phoneExt: cleanString(data.registrarPhoneExt),
    fax: cleanString(data.registrarFax),
    faxExt: cleanString(data.registrarFaxExt),
    email: registrarEmail,
    url: cleanString(data.registrarUrl),
    abuseEmail: cleanString(data.registrarAbuseEmail),
    abusePhone: cleanString(data.registrarAbusePhone),
  };

  // build contacts
  const registrant = buildWhoisContact(data, 'registrant');
  const admin = buildWhoisContact(data, 'admin');
  const tech = buildWhoisContact(data, 'tech');
  const billing = buildWhoisContact(data, 'billing');

  const domainName = toAscii(data.domainName || result.query);
  const domainData: DomainData = {
    // core domain fields
    domainName: domainName,
    domainNameUnicode: isIdn(domainName) ? toUnicode(domainName) : null,
    creationDate: data.creationDate ?? null,
    expirationDate: data.expirationDate ?? null,
    updatedDate: data.updatedDate ?? null,
    nameservers,
    dnssec,
    eppStatus: eppStatus ?? [],
    unmappedStatus: unmappedWhoisStatus(data.eppStatusRaw) ?? [],

    // a whois response that tripped the format's `reserved` pattern (`Reserved by Registry`,
    // `Restricted`, …) describes a name nobody can register, so it is NOT registered even when
    // the registry padded the response with a few fields. A not-found answer never lands
    // here: it is no record, and the caller says the name is available
    available: false,
    reserved: result.reserved === true,

    // entities; a registrar the response said nothing about is none
    registrar: registrarHasData(registrar) ? registrar : null,
    registrant,
    admin,
    tech,
    billing,
  };

  return domainData;
}
