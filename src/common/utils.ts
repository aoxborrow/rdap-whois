// General helpers for names, addresses and values.
import ipaddr from 'ipaddr.js';
import punycode from 'punycode/punycode.js';
import { parse } from 'tldts';
import { isEmpty } from './values';

const punycodeToASCII: (domain: string) => string = punycode.toASCII;
const punycodeToUnicode: (domain: string) => string = punycode.toUnicode;

// The earliest year a registration date can be real: the first .com was registered in 1985.
// Servers write 1970-01-01 or 0001-01-01 for "never", which is no date
export const EARLIEST_REAL_YEAR = 1985;

// a date, or null when it is a server's placeholder for none
export function realDate(date: Date | null | undefined): Date | null {
  if (!date || Number.isNaN(date.getTime())) return null;
  return date.getUTCFullYear() < EARLIEST_REAL_YEAR ? null : date;
}

// strip http, https, or whois protocol from a url
export function stripProtocol(url: string): string {
  // Strip only alphabetic protocols followed by ://
  return String(url)
    .trim()
    .replace(/^[a-zA-Z]+:\/\//, '');
}

// get the protocol from a url
export function getProtocol(url: string): string {
  // Match only alphabetic protocols followed by ://
  const match = /^([a-zA-Z]+):\/\//.exec(String(url).trim());
  return match ? match[1] : '';
}

// normalize domain, remove leading/trailing periods/slashes, etc.
export const normalizeDomain = (domain: string, removeProtocol = true): string => {
  if (isEmpty(domain)) return '';
  // trim spaces, leading/trailing periods, and lowercase
  domain = String(domain)
    .trim()
    .replace(/^[.]+|[.]+$/g, '')
    .toLowerCase();
  // remove protocol by default
  if (removeProtocol) {
    // strip protocols like http, https, or whois
    domain = stripProtocol(domain);
  }
  return domain
    .replace(/\/$/, '') // remove trailing slash if present
    .replace(/^\.+|\.+$/g, '') // remove leading and trailing periods
    .trim(); // one last trim
};

// clean a whois server string, removing protocol and trailing slash
export function normalizeServer(hostname: string, removeProtocol = true): string {
  return normalizeDomain(hostname, removeProtocol);
}

// normalize and punycode a domain
export const toAscii = (domain: string): string => {
  return punycodeToASCII(normalizeDomain(domain));
};

// normalize and un-puny a domain
export const toUnicode = (domain: string): string => {
  return punycodeToUnicode(normalizeDomain(domain));
};

// detect if domain is an IDN (can be in either ascii or unicode format)
export const isIdn = (domain: string): boolean => {
  return toAscii(domain) !== toUnicode(domain);
};

// extract valid icann TLD from domain, or null
export const parseTld = (domain: string): string | null => {
  try {
    // trim spaces, leading period, lowercase, and punycode
    domain = toAscii(domain);
    const parsed = parse(domain);
    return parsed.isIcann ? parsed.publicSuffix : null;
  } catch (e) {
    return null;
  }
};

// detect if domain is a valid icann TLD
export const isTld = (domain: string): boolean => {
  return parseTld(domain) === toAscii(domain);
};

// check for valid ipv4
export const isValidIpv4 = (ip: string) => {
  if (isEmpty(ip)) return false;
  ip = String(ip).trim();
  // the ipaddr library allows for IPs like '111', but we require at least 3 octets
  try {
    // first check if it has at least 3 octets
    const parts = ip.split('.');
    if (parts.length < 3) {
      return false;
    }

    // then use ipaddr.js for final validation
    return ipaddr.IPv4.isValid(ip) || (ip.includes('/') && ipaddr.IPv4.isValidCIDR(ip));
  } catch (e) {
    return false;
  }
};

// check for valid ipv6
export const isValidIpv6 = (ip: string) => {
  if (isEmpty(ip)) return false;
  ip = String(ip).trim();

  // first check if it has at least 3 octets
  const parts = ip.split(':');
  if (parts.length < 3) {
    return false;
  }
  return ipaddr.IPv6.isValid(ip) || (ip.includes('/') && ipaddr.IPv6.isValidCIDR(ip));
};

// query is an IPv4/IPv6 address
export function isValidIp(ip: string): boolean {
  return isValidIpv4(ip) || isValidIpv6(ip);
}

// get parsed IP address (IPv4 or IPv6)
export function parseIp(query: string): string | null {
  if (isEmpty(query)) return null;
  query = String(query).trim();
  // if not a valid IP, returns null
  if (ipaddr.isValidCIDR(query)) {
    return ipaddr.parseCIDR(query).toString();
  }
  return isValidIp(query) ? ipaddr.parse(query).toString() : null;
}

// works with multiple subdomains, and IPs, e.g. www.one.com, 1.2.3.4
export function parseHostname(host: string): string | null {
  try {
    // trim spaces, leading period, lowercase, and punycode
    host = toAscii(host);
    if (!host || host.trim() === '') {
      return null;
    }
    if (isValidIp(host)) {
      return parseIp(host);
    }
    // must be a valid icann name
    const parsed = parse(host);
    if (!parsed.isIcann) {
      return null;
    }
    // bare TLD must be a valid icann TLD
    if (!host.includes('.')) {
      return parsed.publicSuffix === host ? host : null;
    }
    return parsed.hostname ?? null;
  } catch (e) {
    return null;
  }
}

// works with multiple subdomains, and IPs, e.g. www.one.com, 1.2.3.4
export function isValidHostname(host: string): boolean {
  return !!parseHostname(host);
}

// query is a valid icann domain/host/tld
export const isValidDomain = (domain: string): boolean => {
  try {
    // trim spaces, leading period, lowercase, and punycode
    domain = toAscii(domain);
    const parsed = parse(domain);
    // valid icann TLD
    if (parsed.isIcann && parsed.publicSuffix === domain) {
      return true;
    }
    // valid domain
    return !!(parsed?.hostname && parsed?.hostname.length > 0 && parsed.isIcann && !parsed.isIp);
  } catch (e) {
    return false;
  }
};

// type-safe helper to clean string values only
export function cleanString(value: string | null | undefined): string | null {
  return isEmpty(value) ? null : String(value).trim();
}

// clean a url string, optionally force https, otherwise return the original protocol
export function cleanUrl(url: string, forceHttps = true): string {
  // return null for null, undefined, empty string or strings without a dot
  if (isEmpty(url)) return '';

  // trim whitespace, leading/trailing periods, and trailing slash
  let cleanUrl = String(url)
    .trim()
    .replace(/^[.]+|[.]+$/g, '')
    .replace(/\/$/, '');

  // if it's a valid IP address, return it with http:// protocol
  if (isValidIp(stripProtocol(cleanUrl))) {
    return 'http://' + normalizeDomain(cleanUrl, true);
  }

  // return localhost urls as-is
  if (cleanUrl.startsWith('http://localhost')) {
    return cleanUrl;
  }

  // require a dot, and not '#'
  if (!cleanUrl.includes('.') || cleanUrl === '#') {
    return '';
  }

  // don't modify mailto: links
  if (cleanUrl.toLowerCase().startsWith('mailto:')) {
    return cleanUrl;
  }

  // check if it's an email address (contains @ and no protocol)
  if (cleanUrl.includes('@')) {
    return `mailto:${cleanUrl}`;
  }

  // get the original protocol from the url
  const protocol = getProtocol(cleanUrl);

  // now strip the protocol (leaves mailto: links alone)
  cleanUrl = stripProtocol(cleanUrl);

  // if there is bare query string host, add a slash so we can split it correctly
  // e.g. example.com?param=value -> example.com/?param=value
  if (/^[^/]+\?/.test(cleanUrl)) {
    cleanUrl = cleanUrl.replace('?', '/?');
  }

  // split between the hostname and path
  // we do this to avoid lowercasing the path
  const parts = cleanUrl.split('/');
  let hostname = parts[0];
  let path = parts.slice(1).join('/');

  // use normalizeDomain to remove trailing slashes, leading/trailing periods, and lowercase
  hostname = normalizeDomain(hostname, true);

  if (path) {
    // clean the path
    path = path
      .replace(/\/$/, '') // remove trailing slash if present
      .replace(/^\.+|\.+$/g, '') // remove leading and trailing periods
      .trim(); // one last trim

    // remove utm query params
    // e.g. https://netox.apnic.net/search/as4608?utm_source=rdap&utm_medium=result&utm_campaign=rdap_result
    if (path.includes('?')) {
      const [basePath, queryParams] = path.split('?');
      if (queryParams) {
        const params = queryParams.split('&');
        const cleanParams = params.filter(param => !param.startsWith('utm_'));
        path = basePath;
        if (cleanParams.length > 0) {
          path = `${path}?${cleanParams.join('&')}`;
        }
      }
    }
  }

  // re-join the hostname and path
  cleanUrl = `${hostname}${path ? `/${path}` : ''}`;

  // check that there is something left
  if (!cleanUrl) {
    return '';
  }

  // if forceHttps is true, or there is no protocol, add https://, otherwise re-add the original protocol
  const newProtocol = !protocol || forceHttps ? 'https://' : `${protocol}://`;
  return `${newProtocol}${cleanUrl}`;
}

// natural sort comparison function for strings with numeric handling
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, {
    numeric: true,
    sensitivity: 'accent',
  });
}

// sort array values in natural order
export function naturalSort(array: string[]): string[] {
  return [...array].sort(naturalCompare);
}
