import { EppStatus, DomainContactType, DomainContact, DomainRegistrar } from './types';
import { RdapEntityObject, RdapSecureDNS, RdapVcardSimple } from '../rdap/types';
import { EPP_STATUS_VALUES, isEppStatus } from './epp';
import { rdapGetEppStatus } from '../rdap/utils';
import { parseToVcardSimple } from '../rdap/vcard';
import { cleanString } from '../common/utils';
import { isEmpty } from '../common/values';
import { parseCountryCode } from './countries';
import { WhoisDomainData } from '../whois/data-types';
import { cleanArray, cleanStatus } from '../whois/utils';
import { scopedField } from '../whois/fields';
import { statusFormatter } from '../whois/list-formatters';

// an RDAP phone number and its extension, which a tel URI writes as `;ext=`
export function splitRdapPhone(phone: string | null): { phone: string | null; ext: string | null } {
  const match = phone ? /^(.*?);ext=([^;]+)$/i.exec(phone) : null;
  return match
    ? { phone: cleanString(match[1]), ext: cleanString(match[2]) }
    : { phone, ext: null };
}

// map RDAP status values onto EPP codes for the normalized domain view. RDAP has its own
// (larger) vocabulary — entity-scoped values like `validated` or `obscured` describe contact
// records, not a domain's registration state — so anything that doesn't map is dropped here.
// The RDAP response itself keeps the full RFC 9083 set
export function parseRdapStatus(
  statusValues: string[] | string | null | undefined
): EppStatus[] | null {
  if (isEmpty(statusValues)) return null;

  const values = Array.isArray(statusValues) ? statusValues : [statusValues];
  const eppStatuses = values
    .filter(value => !isEmpty(value))
    .map(value => cleanStatus(String(value)))
    .map(cleaned => (cleaned ? rdapStatusToEpp(cleaned) : null))
    .filter(isEppStatus);

  return eppStatuses.length > 0 ? [...new Set(eppStatuses)] : null;
}

// one RDAP status as an EPP code. RDAP's own wording (`client transfer prohibited`) is the
// usual form, but servers also write the EPP code itself in any case or with `_` or `-`
// (`clientTransferProhibited`, `CLIENT_TRANSFER_PROHIBITED`). The unqualified forms
// (`transfer prohibited`) could be the registrar's lock or the registry's, so they map to
// nothing and stay in unmappedStatus
function rdapStatusToEpp(status: string): EppStatus | null {
  const lower = status.toLowerCase().trim();
  const mapped = rdapGetEppStatus(lower.replace(/[_-]+/g, ' ').replace(/\s+/g, ' '));
  if (isEppStatus(mapped)) return mapped;
  const key = lower.replace(/[\s_-]+/g, '');
  return EPP_STATUS_VALUES.find(code => code.toLowerCase() === key) ?? null;
}

// the RDAP statuses that map to no EPP code, as the server wrote them
export function unmappedRdapStatus(
  statusValues: string[] | string | null | undefined
): string[] | null {
  if (isEmpty(statusValues)) return null;
  const values = Array.isArray(statusValues) ? statusValues : [statusValues];
  const unmapped = values
    .filter(value => !isEmpty(value))
    .map(value => String(value).trim())
    .filter(value => parseRdapStatus(value) === null);
  return unmapped.length ? cleanArray(unmapped) : null;
}

// the WHOIS statuses that map to no EPP code, from the values as the server wrote them
export function unmappedWhoisStatus(rawValues: string[] | null | undefined): string[] | null {
  if (isEmpty(rawValues)) return null;
  // one line can hold several statuses, comma-joined as .ru writes them
  const unmapped = (rawValues ?? [])
    .flatMap(value => value.split(','))
    .map(value => value.trim())
    .filter(Boolean)
    .filter(value => statusFormatter(value).length === 0);
  return unmapped.length ? cleanArray(unmapped) : null;
}

// a registrar with nothing in it, which some parsed responses produce, is no registrar
export function registrarHasData(registrar: DomainRegistrar | null): boolean {
  return Boolean(registrar && Object.values(registrar).some(value => !isEmpty(value)));
}

// whether the domain is signed, from RDAP's secureDNS. `delegationSigned` says whether the
// parent holds DS records for the name, which is what signed means for a domain.
// `zoneSigned` is about the zone the name sits in: Google Registry sends
// `zoneSigned: true` for every .dev name, signed or not. Without `delegationSigned`, DS or
// key data means signed
export function parseRdapDnssecValue(secureDNS: RdapSecureDNS): boolean | null {
  if (!secureDNS) return null;
  if (typeof secureDNS.delegationSigned === 'boolean') return secureDNS.delegationSigned;
  if (secureDNS.dsData?.length || secureDNS.keyData?.length) return true;
  return null;
}

// an RDAP entity's phone and fax, each with its extension apart
function phoneFields(phone: string | null, fax: string | null) {
  const voice = splitRdapPhone(phone);
  const facsimile = splitRdapPhone(fax);
  return { phone: voice.phone, phoneExt: voice.ext, fax: facsimile.phone, faxExt: facsimile.ext };
}

// transform RDAP entity to DomainContact
export function rdapEntityToContact(
  entity: RdapEntityObject | undefined,
  type: DomainContactType
): DomainContact | null {
  if (!entity) return null;

  // parse vCard from entity
  let vcard: RdapVcardSimple | null = null;
  if (entity.vcardArray) {
    vcard = parseToVcardSimple(entity.vcardArray);
  }
  if (!vcard) return null;

  const contact: DomainContact = {
    id: cleanString(entity.handle),
    name: cleanString(vcard.name),
    org: cleanString(vcard.org),
    address: vcard.address ? cleanArray(vcard.address) : null,
    city: cleanString(vcard.city),
    state: cleanString(vcard.state),
    postalCode: cleanString(vcard.postalCode),
    countryCode: parseCountryCode(vcard.countryCode),
    ...phoneFields(cleanString(vcard.phone), cleanString(vcard.fax)),
    email: cleanString(vcard.email),
    // prefer contact-uri only if it is not an email
    url: (() => {
      const candidate = vcard.contactUri || vcard.url || null;
      if (!candidate) return null;
      const val = String(candidate);
      if (val.includes('@') || val.toLowerCase().startsWith('mailto:')) return null;
      return cleanString(val) || null;
    })(),
  };

  // if name is null but org exists, copy org to name, clear org
  // we only want org and name if they are different
  if (!contact.name && contact.org) {
    contact.name = contact.org;
    contact.org = null;
  }

  return contactHasData(contact) ? contact : null;
}

// transform RDAP registrar entity to DomainRegistrar
export function rdapEntityToRegistrar(
  entity: RdapEntityObject | undefined
): DomainRegistrar | null {
  if (!entity) return null;
  let vcard: RdapVcardSimple | null = null;
  if (entity.vcardArray) {
    vcard = parseToVcardSimple(entity.vcardArray);
  }
  if (!vcard) return null;

  // the IANA ID only from an `IANA Registrar ID` public ID. The handle is the registry's own
  // identifier (auDA's is not MarkMonitor's IANA ID), and SIDN sends `0000` for none
  const ianaPublicId = entity.publicIds
    ?.find(pid => pid.type === 'IANA Registrar ID')
    ?.identifier?.trim();
  const ianaId =
    ianaPublicId && /^\d+$/.test(ianaPublicId) && Number(ianaPublicId) > 0
      ? Number(ianaPublicId)
      : null;

  // extract abuse contact from nested entities
  let abuseEmail: string | null = null;
  let abusePhone: string | null = null;
  const abuseEntity = entity.entities?.find(e => e.roles?.includes('abuse'));
  if (abuseEntity?.vcardArray) {
    const abuseVcard = parseToVcardSimple(abuseEntity.vcardArray);
    if (abuseVcard) {
      abuseEmail = cleanString(abuseVcard.email);
      abusePhone = cleanString(abuseVcard.phone);
    }
  }

  // parse and validate country code
  const countryCode = parseCountryCode(vcard?.countryCode);

  // get the main email, but only use it if it's different from abuseEmail
  const mainEmail = cleanString(vcard?.email);
  const registrarEmail = mainEmail && mainEmail !== abuseEmail ? mainEmail : null;

  const registrar: DomainRegistrar = {
    ianaId: ianaId,
    name: cleanString(vcard?.name || vcard?.org), // use name or org
    address: vcard?.address ? cleanArray(vcard.address) : null,
    city: cleanString(vcard?.city),
    state: cleanString(vcard?.state),
    postalCode: cleanString(vcard?.postalCode),
    countryCode: countryCode,
    ...phoneFields(cleanString(vcard?.phone), cleanString(vcard?.fax)),
    email: registrarEmail,
    // prefer contact-uri only if it is not an email
    url: (() => {
      const candidate = vcard?.contactUri || vcard?.url || null;
      if (!candidate) return null;
      const val = String(candidate);
      if (val.includes('@') || val.toLowerCase().startsWith('mailto:')) return null;
      return cleanString(val) || null;
    })(),
    abuseEmail: abuseEmail,
    abusePhone: abusePhone,
  };
  return registrar;
}

// helper to build whois contact
export function buildWhoisContact(
  data: WhoisDomainData,
  type: DomainContactType
): DomainContact | null {
  // contact fields are the role plus the attribute, e.g. registrantPostalCode
  const bag = data as unknown as Record<string, string | string[] | null | undefined>;
  const text = (suffix: string) => bag[scopedField(type, suffix)] as string | null | undefined;
  const id = cleanString(text('id'));
  const name = cleanString(text('name'));
  const org = cleanString(text('org'));
  const email = cleanString(text('email'));
  // parse and validate country code
  const countryCode = parseCountryCode(text('country'));

  const finalName = name || org;
  const contact: DomainContact = {
    id,
    name: finalName,
    org: org !== finalName ? org : null, // only set org if different from final name
    address: cleanArray((bag[scopedField(type, 'address')] as string[] | undefined) ?? []),
    city: cleanString(text('city')),
    state: cleanString(text('state')),
    postalCode: cleanString(text('postalCode')),
    countryCode: countryCode,
    phone: cleanString(text('phone')),
    phoneExt: cleanString(text('phoneExt')),
    fax: cleanString(text('fax')),
    faxExt: cleanString(text('faxExt')),
    // if email has no @ sign, then use url field instead
    email: email?.includes('@') ? email : null,
    url: email?.includes('@') ? null : email,
  };
  return contactHasData(contact) ? contact : null;
}

// narrow WhoisDomainData.eppStatus to EppStatus[]. statusFormatter already cleaned, mapped and
// validated these upstream, so this is a type narrowing plus a guard against data that did not
// come from this version's parser (a cache that kept an older answer), not a second parse
export function parseWhoisStatus(
  statusValues: string[] | string | null | undefined
): EppStatus[] | null {
  if (isEmpty(statusValues)) return null;

  const values = Array.isArray(statusValues) ? statusValues : [statusValues];
  const eppStatuses = values.filter(isEppStatus);

  return eppStatuses.length > 0 ? eppStatuses : null;
}

// whether a contact or registrar has anything besides its handle: a contact with only an id
// says nothing about who holds the name
export function hasDetails(value: object | null): boolean {
  if (!value) return false;
  return Object.entries(value).some(
    ([key, field]) => key !== 'id' && field !== null && !(Array.isArray(field) && !field.length)
  );
}

// check if a DomainContact has any meaningful data
export function contactHasData(contact: DomainContact | null): boolean {
  if (!contact) return false;
  return (
    !isEmpty(contact.id) ||
    !isEmpty(contact.name) ||
    !isEmpty(contact.org) ||
    !isEmpty(contact.address) ||
    !isEmpty(contact.city) ||
    !isEmpty(contact.state) ||
    !isEmpty(contact.postalCode) ||
    !isEmpty(contact.countryCode) ||
    !isEmpty(contact.phone) ||
    !isEmpty(contact.phoneExt) ||
    !isEmpty(contact.fax) ||
    !isEmpty(contact.faxExt) ||
    !isEmpty(contact.email) ||
    !isEmpty(contact.url)
  );
}
