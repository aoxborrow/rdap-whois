// The whois parsing foundation: canonical field
// inventory + output order, formatters, and the field-level helpers the engine runs —
// parseField (single-regex extraction), formatFields/formatField, sortFields. `baseParser`
// here is options + formatters only.
import {
  DOMAIN_QUERY_TYPE,
  IP_QUERY_TYPE,
  ASN_QUERY_TYPE,
  ENTITY_QUERY_TYPE,
} from '../common/constants';
import {
  cleanUrl,
  normalizeServer,
  isValidHostname,
  isValidDomain,
  isValidIp,
  realDate,
} from '../common/utils';
import { naturalSort } from '../common/utils';
import { isEmpty } from '../common/values';
import { parseDate, toDateString } from './dates';
import { arrayFormatter, statusFormatter } from './list-formatters';
import { compilePattern } from './regex';
import {
  WhoisQueryType,
  WhoisValue,
  WhoisDataBag,
  FieldFormatter,
  ParserOptions,
} from './data-types';
import { cleanNameserver, cleanArray, singleValue } from './utils';

/**
 * every parsed canonical field, in output order. The parsed data and the fixtures' expected
 * JSON are sorted by it (sortFields), so it must never silently change. Grouped as domain,
 * registrar, contacts, ip/asn/entity.
 */
export const PARSED_FIELDS = [
  // domain fields
  'domainId',
  'domainName',
  'creationDate',
  'expirationDate',
  'registrarExpirationDate',
  'updatedDate',
  'eppStatus',
  'eppStatusRaw',
  'nameservers',
  'dnssec',
  'dnssecRaw',

  // registrar fields
  'registrarId',
  'registrarIanaId',
  'registrarName',
  'registrarOrg',
  'registrarReseller',
  'registrarAddress',
  'registrarCity',
  'registrarState',
  'registrarPostalCode',
  'registrarCountry',
  'registrarPhone',
  'registrarPhoneExt',
  'registrarFax',
  'registrarFaxExt',
  'registrarEmail',
  'registrarUrl',
  'registrarAbuseEmail',
  'registrarAbusePhone',
  'registrarWhoisServer',

  // registrant fields
  'registrantId',
  'registrantName',
  'registrantOrg',
  'registrantAddress',
  'registrantCity',
  'registrantState',
  'registrantPostalCode',
  'registrantCountry',
  'registrantPhone',
  'registrantPhoneExt',
  'registrantFax',
  'registrantFaxExt',
  'registrantEmail',

  // administrative fields
  'adminId',
  'adminName',
  'adminOrg',
  'adminAddress',
  'adminCity',
  'adminState',
  'adminPostalCode',
  'adminCountry',
  'adminPhone',
  'adminPhoneExt',
  'adminFax',
  'adminFaxExt',
  'adminEmail',

  // technical fields
  'techId',
  'techName',
  'techOrg',
  'techAddress',
  'techCity',
  'techState',
  'techPostalCode',
  'techCountry',
  'techPhone',
  'techPhoneExt',
  'techFax',
  'techFaxExt',
  'techEmail',

  // billing fields
  'billingId',
  'billingName',
  'billingOrg',
  'billingAddress',
  'billingCity',
  'billingState',
  'billingPostalCode',
  'billingCountry',
  'billingPhone',
  'billingPhoneExt',
  'billingFax',
  'billingFaxExt',
  'billingEmail',

  // ip fields
  'ipId',
  'ipAddress',

  // asn fields
  'asnId',
  'asnName',

  // entity fields
  'entityId',
  'entityName',
];

// entity ID fields
export const ID_FIELDS = [
  'domainId',
  'registrarId',
  'registrantId',
  'adminId',
  'techId',
  'billingId',
  'entityId',
  'asnId',
  'ipId',
];

// address fields that are arrays
export const ADDRESS_FIELDS = [
  'registrarAddress',
  'registrantAddress',
  'adminAddress',
  'techAddress',
  'billingAddress',
];

/** fields that are arrays */
export const ARRAY_FIELDS = ['eppStatus', 'eppStatusRaw', 'nameservers', ...ADDRESS_FIELDS];

// date fields that are required to be in our date string format
export { DATE_FIELDS } from './date-fields';

// fields that are required in final result, even if empty
export const DOMAIN_REQUIRED_FIELDS = [
  'domainId',
  'domainName',
  'creationDate',
  'expirationDate',
  'updatedDate',
  'registrarId',
  'registrarName',
  'registrarUrl',
  'registrarWhoisServer',
  'eppStatus',
  'eppStatusRaw',
  'nameservers',
  'dnssec',
];

// TODO: fill these out once we are parsing these query types
// fields that are required in final result, even if empty
export const IP_REQUIRED_FIELDS = ['ipId', 'ipAddress'];

// fields that are required in final result, even if empty
export const ASN_REQUIRED_FIELDS = ['asnId', 'asnName'];

// fields that are required in final result, even if empty
export const ENTITY_REQUIRED_FIELDS = ['entityId', 'entityName'];

// get the required fields for a given query type
export const REQUIRED_FIELDS = {
  [DOMAIN_QUERY_TYPE]: DOMAIN_REQUIRED_FIELDS,
  [IP_QUERY_TYPE]: IP_REQUIRED_FIELDS,
  [ASN_QUERY_TYPE]: ASN_REQUIRED_FIELDS,
  [ENTITY_QUERY_TYPE]: ENTITY_REQUIRED_FIELDS,
};

// every field the parsed data of a query type has, present and null when the response did
// not give it
const fieldsBetween = (first: string, last: string): string[] =>
  PARSED_FIELDS.slice(PARSED_FIELDS.indexOf(first), PARSED_FIELDS.indexOf(last) + 1);
export const QUERY_TYPE_FIELDS: Record<WhoisQueryType, string[]> = {
  [DOMAIN_QUERY_TYPE]: fieldsBetween('domainId', 'billingEmail'),
  [IP_QUERY_TYPE]: fieldsBetween('ipId', 'ipAddress'),
  [ASN_QUERY_TYPE]: fieldsBetween('asnId', 'asnName'),
  [ENTITY_QUERY_TYPE]: fieldsBetween('entityId', 'entityName'),
};

// get the required fields for a given query type
export const getRequiredFields = (queryType: WhoisQueryType): string[] => {
  if (!REQUIRED_FIELDS[queryType]) {
    throw new Error(`No required fields defined for query type: ${queryType}`);
  }
  return REQUIRED_FIELDS[queryType];
};

// handle fields that should only have one value, the first match
export const singleFormatter: FieldFormatter<string | null> = (
  value: WhoisValue,
  field?: string,
  queryType?: WhoisQueryType,
  options?: ParserOptions
): string | null => {
  if (isEmpty(value)) return null;
  // if the value is an array, return the first value and trim
  return singleValue(value);
};

// handle fields that should only have one lowercase value
export const singleLowercaseFormatter: FieldFormatter<string | null> = (
  value: WhoisValue,
  field?: string,
  queryType?: WhoisQueryType,
  options?: ParserOptions
): string | null => {
  if (isEmpty(value)) return null;
  // if the value is an array, use the first value, lowercase and trim
  return singleValue(value, true);
};

// handle fields that should only have one lowercase url
export const singleUrlFormatter: FieldFormatter<string | null> = (
  value: WhoisValue,
  field?: string,
  queryType?: WhoisQueryType,
  options?: ParserOptions
): string | null => {
  if (isEmpty(value)) return null;
  // if the value is an array, use the first value, lowercase and trim
  const single = singleValue(value, true);
  // don't force any protocol, just clean the url
  const cleaned = cleanUrl(single || '', false);
  // return null if empty or invalid
  return cleaned ? cleaned : null;
};

// handle fields that should only have one lowercase hostname or URL
export const singleServerFormatter: FieldFormatter<string | null> = (
  value: WhoisValue,
  field?: string,
  queryType?: WhoisQueryType,
  options?: ParserOptions
): string | null => {
  if (isEmpty(value)) return null;
  // if the value is an array, use the first value, lowercase and trim
  const single = singleValue(value, true);
  // don't strip protocol or path, allows for http/web whois servers
  return (single && normalizeServer(single, false)) ?? null;
};

// handle fields that should only have one lowercase hostname
export const singleDomainFormatter: FieldFormatter<string | null> = (
  value: WhoisValue,
  field?: string,
  queryType?: WhoisQueryType,
  options?: ParserOptions
): string | null => {
  if (isEmpty(value)) return null;
  // if the value is an array, use the first value, lowercase and trim
  const single = singleValue(value, true);
  // strip protocol and path
  return (single && normalizeServer(single, true)) ?? null;
};

// this is only used for parseReferralServer()
export const whoisServerFormatter: FieldFormatter<string | null> = (
  value: WhoisValue,
  field?: string,
  queryType?: WhoisQueryType,
  options?: ParserOptions
): string | null => {
  if (isEmpty(value)) return null;
  // first split into array and handle newlines/commas
  const splitArray = arrayFormatter(value, field, queryType, options);
  // return first valid whois server
  for (let i = 0; i < splitArray.length; i++) {
    let server = splitArray[i];
    server = normalizeServer(server);
    if (server && !isEmpty(server) && isValidHostname(server)) {
      // reject if url has a path beyond root. likely a web whois site, not a whois server
      // reject if hostname starts with www. or web-whois. likely a web whois site, not a whois server
      if (!server.includes('/') && !server.startsWith('www.') && !server.startsWith('web-whois.')) {
        return server;
      }
    }
  }
  return null;
};

// parse date fields. A value that cannot be read as a date, or that is before any real
// registration, is dropped
export const dateFormatter: FieldFormatter<Date | null> = (
  value: WhoisValue,
  field?: string,
  queryType?: WhoisQueryType,
  options?: ParserOptions
): Date | null => {
  if (value instanceof Date) return realDate(value);
  if (isEmpty(value)) return null;
  // enforce single value for date fields
  const singleValue = Array.isArray(value) ? value[0] : value;
  // a server's placeholder for "never" (1970-01-01, 0001-01-01) is no date
  return realDate(parseDate(String(singleValue), options));
};

// the array split and the status list live in list-formatters.ts, which the record code
// imports on its own
export { arrayFormatter, statusFormatter };

// format array address fields
export const addressFormatter: FieldFormatter<string[]> = (
  value: WhoisValue,
  field?: string,
  queryType?: WhoisQueryType,
  options?: ParserOptions
): string[] => {
  if (isEmpty(value)) return [];

  // if not an array, convert to array and clean
  const arrayValues = Array.isArray(value) ? cleanArray(value) : [String(value)];

  // for address fields only split on newlines, not commas
  const splitRegex = /[\n]/;

  // process each element for potential splits and flatten the result
  const splitValues = arrayValues.reduce<string[]>((acc, v) => {
    if (v === null) return acc;
    return [...acc, ...v.split(splitRegex).map(part => part.trim())];
  }, []);

  // remove empties, duplicates, and return values in original order
  return cleanArray(splitValues);
};

// handle nameserver specific formatting after passing to arrayFormatter
export const nameserverFormatter: FieldFormatter<string[]> = (
  value: WhoisValue,
  field?: string,
  queryType?: WhoisQueryType,
  options?: ParserOptions
): string[] => {
  if (isEmpty(value)) return [];
  // first split into array and handle newlines/commas
  const splitArray = arrayFormatter(value);

  // then clean and validate each nameserver. A registry's Name Server value only needs to
  // be a real host — an IP, or a valid hostname under a real TLD. The shared
  // isValidNameserver is deliberately stricter (it judges whether a QUERY string looks
  // nameserver-shaped) and rejects legitimate registry values like `ns.uz` (2 labels) or
  // `ns1.gov.bh` (a registrable domain under a public suffix)
  const validArray = splitArray.map(cleanNameserver).filter(hostname =>
    isValidIp(hostname as string)
      ? true
      : // an interior dot is required (no bare TLDs), a leading dot means a suffix
        // fragment from boilerplate (`.edu.hk`), and a slash means a URL from boilerplate
        // (nominet's `https://theukdomain.uk/rdap` banner) — isValidHostname/isValidDomain
        // tolerate all three
        /^[^.].*\./.test(hostname as string) &&
        !(hostname as string).includes('/') &&
        isValidHostname(hostname as string) &&
        isValidDomain(hostname as string)
  ) as string[];

  // remove empties, duplicates, etc
  const cleanedArray = cleanArray(validArray);

  // natural sort the array
  return naturalSort(cleanedArray);
};

// eppStatusRaw is the pre-normalization view of the same values: it answers "what did the
// registry actually write", so it deliberately does NOT run arrayFormatter (which strips
// bracketed content, splits on commas, dedupes case-insensitively and sorts) or cleanStatus
// (which drops glosses and epp links). only newline splitting and empty removal
export const rawStatusFormatter: FieldFormatter<string[]> = (
  value: WhoisValue,
  field?: string,
  queryType?: WhoisQueryType,
  options?: ParserOptions
): string[] => {
  if (isEmpty(value)) return [];

  const arrayValues = Array.isArray(value) ? value : [value];
  return arrayValues
    .filter(v => v !== null && v !== undefined)
    .flatMap(v => String(v).split('\n'))
    .map(v => v.trim())
    .filter(v => !isEmpty(v));
};

// what formatFields/formatField read: the parser options and a formatter per field
export interface WhoisFormatterSet {
  options: ParserOptions;
  formatters: Record<string, FieldFormatter>;
}

// the default base parser that all parsers are merged with: options + formatters. The engine
// merges per-format options over it and runs these formatters (mapping.ts).
export const baseParser: WhoisFormatterSet = {
  // parsers can define options
  options: {
    dayFirst: false, // date format configuration
  },

  // custom field formatters, all other fields use singleFormatter
  formatters: {
    // single value fields
    domainName: singleDomainFormatter,
    // registrarName: singleFormatter,
    registrarUrl: singleUrlFormatter,
    registrarWhoisServer: singleServerFormatter,
    // date fields
    creationDate: dateFormatter,
    expirationDate: dateFormatter,
    registrarExpirationDate: dateFormatter,
    updatedDate: dateFormatter,
    // array fields
    eppStatus: statusFormatter,
    eppStatusRaw: rawStatusFormatter,
    nameservers: nameserverFormatter,
    // dnssec: singleLowercaseFormatter,
    registrarAddress: addressFormatter,
    registrantAddress: addressFormatter,
    adminAddress: addressFormatter,
    techAddress: addressFormatter,
    billingAddress: addressFormatter,
  },
};

// parse a single field using the given regex pattern and return the value
export function parseField(regex: string, raw: string): string[] {
  // skip if pattern is not defined or empty
  if (!regex) return [];

  // iterate over the regex matches
  const regExp = compilePattern(regex, 'gm');
  const matches: string[] = [];
  let captures;
  while ((captures = regExp.exec(raw)) !== null) {
    // take the first capturing group that has a value
    let capture: string | null = null;
    for (let i = 1; i < captures.length; i++) {
      if (captures[i] !== undefined) {
        capture = captures[i];
        break;
      }
    }
    // trim the value if it's a string
    const processedValue = typeof capture === 'string' ? capture.trim() : capture;
    // avoid duplicates
    if (
      processedValue !== undefined &&
      processedValue !== null &&
      processedValue !== '' &&
      !matches.some(v => String(v).toLowerCase() === String(processedValue).toLowerCase())
    ) {
      // not a duplicate or null/undefined/empty
      matches.push(processedValue);
    }
  }

  // return the array of values if there are any, otherwise return null
  return matches;
}

// apply field-specific formatters
export function formatFields(
  parser: WhoisFormatterSet,
  data: WhoisDataBag,
  queryType: WhoisQueryType
): WhoisDataBag {
  // for each field formatter function, pass it the current result value to format, which may be undefined
  Object.entries(data).forEach(([field, value]) => {
    data[field] = formatField(parser, field, value, queryType);
  });
  return data;
}

// Function to format field value
export function formatField(
  parser: WhoisFormatterSet,
  field: string,
  value: WhoisValue,
  queryType: WhoisQueryType
): WhoisValue {
  // for each field formatter function, pass it the current result value to format, which may be undefined
  if (parser.formatters && typeof parser.formatters[field] === 'function') {
    return parser.formatters[field](value, field, queryType, parser.options || {});
  } else {
    // if no custom field formatter is defined, use the singleFormatter
    return singleFormatter(value, field, queryType, parser.options || {});
  }
}

// Sort fields according to PARSED_FIELDS order
export function sortFields(data: WhoisDataBag): WhoisDataBag {
  const orderedData: Record<string, WhoisValue> = {};
  // First add fields in the order they appear in PARSED_FIELDS
  PARSED_FIELDS.forEach(field => {
    if (field in data) {
      orderedData[field] = data[field];
    }
  });

  // Then add any remaining fields in natural sort order
  Object.keys(data)
    .filter(field => !(field in orderedData))
    .sort()
    .forEach(field => {
      orderedData[field] = data[field];
    });
  return orderedData;
}
