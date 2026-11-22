// The combined domain record: one answer built from every server that answered a lookup.
//
// A lookup usually asks two servers, the registry and then the registrar it points to. The
// record takes each group of fields whole from the server that holds it: the delegation
// (nameservers, DNSSEC) and the statuses from the registry, which publishes the zone and
// enforces the locks; the registrar's details, the contacts and the updated date from the
// registrar, which holds the fuller data. A group one side left empty comes from the other.
// The creation date is the earlier of the two, since a registrar's is often the day the
// name moved to it. The record also carries the registry's own expiry and the reseller.
// Beside it go where each group came from and a list of where the registry and the
// registrar disagree, which lookup() returns when asked to be verbose. The rule and the
// measurements behind it are in docs/merge.md.
import {
  REGISTRAR_SERVER_TYPE,
  REGISTRY_SERVER_TYPE,
  UNKNOWN_SERVER_TYPE,
  type ServerType,
} from '../common/constants';
import { cleanString, isIdn, isTld, realDate, toAscii, toUnicode } from '../common/utils';
import { InvalidResponseError } from '../errors';
import type { RdapEntityObject, RdapResponse } from '../rdap/types';
import { findEntitiesByRole, findEventByAction, isDomainResponse } from '../rdap/utils';
import { parseToVcardSimple } from '../rdap/vcard';
import { parseRdapDate, validateRdapDomain } from '../rdap/validate';
import type { WhoisDataType, WhoisDomainData } from '../whois/data-types';
import { transformRdapDomainData, transformWhoisDomainData } from './transforms';
import type { DomainData } from './types';
import { hasDetails, registrarHasData } from './utils';

export interface DomainRecord extends DomainData {
  // the reseller the registrar sold the name through, when a server named one
  reseller: string | null;
  // `expirationDate` is the registrar's expiry, else the registry's: the registrar is the
  // one that renews the name, and some registrars send only a `registrar expiration` event.
  // `registryExpirationDate` is the registry's own expiry, for when it differs from the
  // registrar's: mostly a registry that has auto-renewed the name a year ahead of the
  // registrar, which matters for expiry and drop monitoring
  registryExpirationDate: Date | null;
}

// a field where the registry and the registrar both gave a value and the values differ. For
// `eppStatus` the two values are each side's client* codes, the ones both sides can set,
// and either can be []
export interface Discrepancy {
  field: 'creationDate' | 'expirationDate' | 'nameservers' | 'eppStatus' | 'dnssec';
  registry: unknown;
  registrar: unknown;
}

// one server's answer, as the record is built from it
export interface RecordHop {
  protocol: 'rdap' | 'whois';
  serverType: ServerType;
  // the server's answer as a record of its own
  record: DomainData;
  // the expiry this server gave as the registrar's, when it said which one it was
  registrarExpiration: Date | null;
  reseller: string | null;
}

const DAY = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------------------
// reseller
// ---------------------------------------------------------------------------------------

function entityName(entity: RdapEntityObject | undefined): string | null {
  if (!entity?.vcardArray) return null;
  try {
    const vcard = parseToVcardSimple(entity.vcardArray);
    return cleanString(vcard?.org) ?? cleanString(vcard?.name);
  } catch {
    // a vCard that cannot be read has no name to give
    return null;
  }
}

// the reseller entity of an RDAP domain, at the top level or under the registrar
function rdapReseller(data: RdapResponse): string | null {
  if (!isDomainResponse(data)) return null;
  const top = findEntitiesByRole(data.entities, 'reseller')[0];
  if (top) return entityName(top);
  for (const registrar of findEntitiesByRole(data.entities, 'registrar')) {
    const nested = findEntitiesByRole(registrar.entities, 'reseller')[0];
    if (nested) return entityName(nested);
  }
  return null;
}

// ---------------------------------------------------------------------------------------
// one hop
// ---------------------------------------------------------------------------------------

function rdapEventDate(data: RdapResponse, action: string): Date | null {
  if (!isDomainResponse(data)) return null;
  const value = findEventByAction(data.events, action)?.eventDate;
  if (!value) return null;
  // a date with no time zone is UTC, the same in every runtime
  return realDate(parseRdapDate(value));
}

// an RDAP response as a hop of the record, or null when it is not a domain object. With
// `validate`, a response about some other domain is thrown as an InvalidResponseError; a
// response the transform cannot read throws whatever the transform threw
export function rdapRecordHop(
  query: string,
  serverType: ServerType,
  data: RdapResponse | null,
  validate: boolean
): RecordHop | null {
  if (!data || !isDomainResponse(data)) return null;
  // a response the transform cannot read throws, so the caller can say why it was not used
  let record: DomainData = transformRdapDomainData({ query, queryType: 'domain', data });

  // a registration date that cannot be right is dropped
  if (validate) {
    const validation = validateRdapDomain(data, query);
    // a response about some other domain is not an answer to this query
    if (validation.name === 'mismatch') {
      throw new InvalidResponseError(
        `answered about "${validation.responseName}", not "${query}"`,
        { protocol: 'rdap', query }
      );
    }
    record = { ...record, creationDate: realDate(validation.creationDate) };
  }
  return {
    protocol: 'rdap',
    serverType,
    record,
    registrarExpiration: rdapEventDate(data, 'registrar expiration'),
    reseller: rdapReseller(data),
  };
}

// A domain name's labels, lowercased and in ASCII
function asciiLabels(name: string): string[] | null {
  try {
    return toAscii(name.trim().replace(/\.$/, '').toLowerCase()).split('.');
  } catch {
    return null;
  }
}

// Whether the answered name is the name asked about, or a name above it: a registry answers
// a host with the registered name it is under (whois.nic.uk answers www.gov.uk with
// gov.uk's). Registries that run variant TLDs answer under the variant they publish (TWNIC
// answers nic.台湾 as nic.台灣), so two internationalised TLDs count as the same
function answersFor(answered: string[], asked: string[]): boolean {
  if (answered.length > asked.length) return false;
  const tldA = answered[answered.length - 1];
  const tldB = asked[asked.length - 1];
  const variants = tldA.startsWith('xn--') && tldB.startsWith('xn--');
  if (tldA !== tldB && !variants) return false;
  const below = answered.slice(0, -1).join('.');
  const askedBelow = asked.slice(0, -1).join('.');
  return askedBelow === below || askedBelow.endsWith(`.${below}`);
}

// The name a WHOIS response gives, when it is some other domain than the one asked about or
// a name above it, as an answer from a cache or a registrar's mix-up can be. A response that
// gives no name is not one of these: WHOIS ties an answer to its query by the connection it
// came back on, and some registries never echo the name (whois.nic.cl). A TLD's record, as
// IANA answers, is left to describesTld
export function whoisNameMismatch(query: string, data: WhoisDataType): string | null {
  const name = cleanString((data as WhoisDomainData).domainName);
  if (!name || isTld(name)) return null;
  const answered = asciiLabels(name);
  const asked = asciiLabels(query);
  if (!answered || !asked) return null;
  return answersFor(answered, asked) ? null : name;
}

// a parsed WHOIS response as a hop of the record
export function whoisRecordHop(
  query: string,
  serverType: ServerType,
  data: WhoisDataType | null,
  reserved = false
): RecordHop | null {
  if (!data) return null;
  // a response about some other domain is not an answer to this query
  const other = whoisNameMismatch(query, data);
  if (other) {
    throw new InvalidResponseError(`answered about "${other}", not "${query}"`, {
      protocol: 'whois',
      query,
    });
  }
  // a response the transform cannot read throws, so the caller can say why it was not used
  const record: DomainData = transformWhoisDomainData({
    query,
    queryType: 'domain',
    data,
    reserved,
  });
  return {
    protocol: 'whois',
    serverType,
    record,
    // the registrar's expiry, when the response names it as the registrar's. Otherwise whose
    // expiry it is follows from which server gave it
    registrarExpiration: (data as WhoisDomainData).registrarExpirationDate ?? null,
    reseller: cleanString((data as WhoisDomainData).registrarReseller),
  };
}

// ---------------------------------------------------------------------------------------
// combining hops
// ---------------------------------------------------------------------------------------

const sameSet = (a: readonly string[], b: readonly string[]): boolean => {
  const left = new Set(a.map(value => value.toLowerCase()));
  const right = new Set(b.map(value => value.toLowerCase()));
  return left.size === right.size && [...left].every(value => right.has(value));
};

// the statuses a registrar sets. The server* ones are the registry's by definition, so a
// registrar listing fewer of them is not a disagreement
const clientStatus = (statuses: readonly string[]): string[] =>
  statuses.filter(status => status.startsWith('client'));

// where the registry and the registrar both said something and disagree. Dates count only
// when more than a day apart: under a day is formatting (a time zone, a missing time of
// day), which is more than half of all creation dates. The updated date is never compared;
// the registrar's is when its own record changed, a different fact. Statuses are compared
// on the client* codes only, the ones both sides can hold
function findDiscrepancies(registry: RecordHop, registrar: RecordHop): Discrepancy[] {
  const out: Discrepancy[] = [];
  const a = registry.record;
  const b = registrar.record;

  if (
    a.creationDate &&
    b.creationDate &&
    Math.abs(a.creationDate.getTime() - b.creationDate.getTime()) > DAY
  ) {
    out.push({ field: 'creationDate', registry: a.creationDate, registrar: b.creationDate });
  }
  const registrarExpiry = registrar.registrarExpiration ?? b.expirationDate;
  if (
    a.expirationDate &&
    registrarExpiry &&
    Math.abs(a.expirationDate.getTime() - registrarExpiry.getTime()) > DAY
  ) {
    out.push({ field: 'expirationDate', registry: a.expirationDate, registrar: registrarExpiry });
  }
  if (a.nameservers.length && b.nameservers.length && !sameSet(a.nameservers, b.nameservers)) {
    out.push({ field: 'nameservers', registry: a.nameservers, registrar: b.nameservers });
  }
  const registryClient = clientStatus(a.eppStatus);
  const registrarClient = clientStatus(b.eppStatus);
  if (a.eppStatus.length && b.eppStatus.length && !sameSet(registryClient, registrarClient)) {
    out.push({ field: 'eppStatus', registry: registryClient, registrar: registrarClient });
  }
  if (a.dnssec !== null && b.dnssec !== null && a.dnssec !== b.dnssec) {
    out.push({ field: 'dnssec', registry: a.dnssec, registrar: b.dnssec });
  }
  return out;
}

// the groups of the record that are each taken whole from one server
export type RecordGroup =
  | 'registrar'
  | 'contacts'
  | 'status'
  | 'nameservers'
  | 'dnssec'
  | 'creationDate'
  | 'updatedDate'
  | 'expirationDate';

// which server each group of the record came from: the registry or the registrar it
// referred to, or null when neither gave it
export type RecordProvenance = Record<RecordGroup, 'registry' | 'registrar' | null>;

export interface CombinedRecord {
  record: DomainRecord;
  // the hop the result rests on: the registrar's when it answered, else the registry's
  base: RecordHop;
  provenance: RecordProvenance;
  discrepancies: Discrepancy[];
}

// a date that can be a creation date: not in the future, and not after the expiry the same
// server gave. RDAP's are checked when the hop is made; this holds WHOIS's to the same
// standard before one date is chosen over another
function plausibleCreation(hop: RecordHop): Date | null {
  // a date before 1985 is a server's placeholder for none
  const created = realDate(hop.record.creationDate);
  if (!created) return null;
  const expires = hop.registrarExpiration ?? hop.record.expirationDate;
  if (created.getTime() > Date.now() + DAY) return null;
  if (expires && created.getTime() > expires.getTime() + DAY) return null;
  return created;
}

const contactsOf = (record: DomainData) => [
  record.registrant,
  record.admin,
  record.tech,
  record.billing,
];
const hasContacts = (record: DomainData): boolean => contactsOf(record).some(Boolean);
// handles alone don't count, so the other side's contacts are taken over them
const hasContactDetails = (record: DomainData): boolean => contactsOf(record).some(hasDetails);

// build one record from the hops that answered, in the order they were asked: each group
// from the side that holds it, with each side's expiry and the reseller beside it
export function combineHops(hops: RecordHop[]): CombinedRecord | null {
  const last = hops[hops.length - 1];
  if (!last) return null;

  // the registrar is the last hop when it is typed as one and something came before it. The
  // registry is the hop typed as one, found by its type: a lookup that began at IANA has
  // IANA's own answer first
  const registrar = hops.length > 1 && last.serverType === REGISTRAR_SERVER_TYPE ? last : null;
  const registry = registrar
    ? (hops.find(hop => hop !== registrar && hop.serverType === REGISTRY_SERVER_TYPE) ??
      hops[hops.length - 2])
    : last;

  const registryExpirationDate = registrar
    ? registry.record.expirationDate
    : // a single hop that is itself a registrar has no registry date to report
      registry.serverType === REGISTRAR_SERVER_TYPE
      ? null
      : registry.record.expirationDate;
  const registrarExpiration = registrar
    ? (registrar.registrarExpiration ?? registrar.record.expirationDate)
    : registry.serverType === REGISTRAR_SERVER_TYPE
      ? (registry.registrarExpiration ?? registry.record.expirationDate)
      : // some registries pass on the registrar's date themselves
        registry.registrarExpiration;

  // the side a single hop speaks for; a server the data does not know is neither
  const own = (hop: RecordHop): 'registry' | 'registrar' | null =>
    hop.serverType === REGISTRAR_SERVER_TYPE
      ? 'registrar'
      : hop.serverType === UNKNOWN_SERVER_TYPE
        ? null
        : 'registry';
  const expirationDate = registrarExpiration ?? registryExpirationDate;
  const expiryFrom = registrarExpiration ? 'registrar' : registryExpirationDate ? 'registry' : null;

  if (!registrar) {
    const { record } = registry;
    const side = own(registry);
    const from = (present: unknown) => (present ? side : null);
    return {
      record: {
        ...record,
        expirationDate,
        reseller: registry.reseller,
        registryExpirationDate,
      },
      base: registry,
      provenance: {
        registrar: from(record.registrar),
        contacts: from(hasContacts(record)),
        status: from(record.eppStatus.length || record.unmappedStatus.length),
        nameservers: from(record.nameservers.length),
        dnssec: from(record.dnssec !== null),
        creationDate: from(record.creationDate),
        updatedDate: from(record.updatedDate),
        // one server answered, so its expiry is its own, even one it passed on as the
        // registrar's
        expirationDate: from(expirationDate),
      },
      discrepancies: [],
    };
  }

  // each group whole from one side: `first` when it gave the group, else `second`
  const a = registry.record;
  const b = registrar.record;
  const pick = <T>(
    first: 'registry' | 'registrar',
    given: (record: DomainData) => boolean,
    take: (record: DomainData) => T
  ): [T, 'registry' | 'registrar' | null] => {
    const [x, y] = first === 'registry' ? [a, b] : [b, a];
    const other = first === 'registry' ? 'registrar' : 'registry';
    if (given(x)) return [take(x), first];
    if (given(y)) return [take(y), other];
    return [take(x), null];
  };

  const [status, statusFrom] = pick(
    'registry',
    record => Boolean(record.eppStatus.length || record.unmappedStatus.length),
    record => ({ eppStatus: record.eppStatus, unmappedStatus: record.unmappedStatus })
  );
  const [nameservers, nameserversFrom] = pick(
    'registry',
    record => Boolean(record.nameservers.length),
    record => record.nameservers
  );
  const [dnssec, dnssecFrom] = pick(
    'registry',
    record => record.dnssec !== null,
    record => record.dnssec
  );
  const takeContacts = (record: DomainData) => ({
    registrant: record.registrant,
    admin: record.admin,
    tech: record.tech,
    billing: record.billing,
  });
  const detailed = pick('registrar', hasContactDetails, takeContacts);
  const [contacts, contactsFrom] = detailed[1]
    ? detailed
    : pick('registrar', hasContacts, takeContacts);
  // the registrar's details, unless it gave neither its name nor its IANA ID
  const [registrarGroup, registrarFrom] = pick(
    'registrar',
    record => Boolean(record.registrar?.name || record.registrar?.ianaId),
    record => record.registrar
  );
  const [updatedDate, updatedFrom] = pick(
    'registrar',
    record => record.updatedDate !== null,
    record => record.updatedDate
  );

  // the earlier creation date of the two that can be right: a registrar's is often the day
  // the name moved to it (opera.com: 1999 at Verisign, 2017 at the registrar), and now and
  // then the registry's object is newer than the registration (google.com.bh)
  const registryCreated = plausibleCreation(registry);
  const registrarCreated = plausibleCreation(registrar);
  const [creationDate, creationFrom] =
    registryCreated && (!registrarCreated || registryCreated <= registrarCreated)
      ? [registryCreated, 'registry' as const]
      : registrarCreated
        ? [registrarCreated, 'registrar' as const]
        : [null, null];

  return {
    record: {
      ...b,
      ...status,
      ...contacts,
      nameservers,
      dnssec,
      creationDate,
      updatedDate,
      expirationDate,
      registrar: registrarGroup,
      reseller: registrar.reseller ?? registry.reseller,
      registryExpirationDate,
    },
    base: registrar,
    provenance: {
      registrar: registrarFrom,
      contacts: contactsFrom,
      status: statusFrom,
      nameservers: nameserversFrom,
      dnssec: dnssecFrom,
      creationDate: creationFrom,
      updatedDate: updatedFrom,
      expirationDate: expiryFrom,
    },
    discrepancies: findDiscrepancies(registry, registrar),
  };
}

// ---------------------------------------------------------------------------------------
// answers with no data
// ---------------------------------------------------------------------------------------

// the record for a name the registry said does not exist
export function availableRecord(query: string): DomainRecord {
  const domainName = toAscii(query);
  return {
    domainName,
    domainNameUnicode: isIdn(domainName) ? toUnicode(domainName) : null,
    creationDate: null,
    expirationDate: null,
    registryExpirationDate: null,
    updatedDate: null,
    nameservers: [],
    dnssec: null,
    eppStatus: [],
    unmappedStatus: [],
    available: true,
    reserved: false,
    registrar: null,
    reseller: null,
    registrant: null,
    admin: null,
    tech: null,
    billing: null,
  };
}

// A record is a usable answer when it says something about the domain's registration: who
// sells it (a registrar with something in it), who holds it, where it is delegated, or when
// it was created. Several registries publish no more than the last two (.no, .mo, .ir, .hu,
// .md). A response that parses to nothing (a refusal the parser does not know, an empty
// record) has none of them; a status alone is not enough either. Whether the response is
// about this domain at all is checked when the hop is made (whoisNameMismatch, and RDAP's
// validation)
export function isUsableRecord(record: DomainData): boolean {
  if (!record.domainName) return false;
  return (
    registrarHasData(record.registrar) ||
    record.registrant !== null ||
    record.nameservers.length > 0 ||
    record.creationDate !== null
  );
}

// The record describes the TLD itself, not the name asked for. IANA's WHOIS answers a
// domain query under a TLD with no WHOIS server of its own with the TLD's root-zone record,
// which parses into a convincing registration. The tell is that the parsed name is a public
// suffix; a bare TLD query is legitimately answered by the TLD's record
export function describesTld(record: DomainData, query: string): boolean {
  if (!record.domainName) return false;
  if (isTld(query)) return false;
  return isTld(record.domainName);
}
