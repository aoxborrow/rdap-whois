// The address a WHOIS server says a request came from, replaced before a response goes into
// the fixture corpus.
//
// Some servers say back who asked ("% Request from 203.0.113.9", "# Hello 203.0.113.9. Your
// session has been logged."). In a recording that is the machine that made the recording,
// or its proxy, which is not registration data and not public, so it becomes a
// documentation address. Everything else in a response is kept as the server sent it.
import { parseBlocks } from '../../../src/whois/mapping';
import { DOMAIN_QUERY_TYPE } from '../../../src/common/constants';
import { stripRawMetadata } from './raw';

// The lines on which a server says back the address the request came from. Each pattern
// ends where the address starts. An IPv4-mapped IPv6 address (::ffff:198.18.7.42, from a
// dual-stack socket) is matched whole, ahead of plain IPv6, and plain IPv6 may not stop
// short of a dot or a colon: a part of an address left behind is still the address
const IP = String.raw`(?:[0-9a-f]{0,4}:){2,6}(?:\d{1,3}\.){3}\d{1,3}|(?:\d{1,3}\.){3}\d{1,3}|(?=[0-9a-f:]*:[0-9a-f:]*:)[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7}(?![:\w]|\.[0-9a-f])`;
const CLIENT_ECHO = [
  String.raw`^%[ \t]*request from[ \t]+`,
  String.raw`^source ip:[ \t]*`,
  String.raw`^#[ \t]*hello[ \t]+`,
  String.raw`^%[ \t]*\d{4}-\d{2}-\d{2}T[\d:.+-]+[ \t]+-[ \t]+`,
  String.raw`^%%[ \t]*\[(?=[^\]\n]*request\])`,
  String.raw`^[ \t]*request limit exceeded for[ \t]+`,
  String.raw`^.*\bquery quota for[ \t]+`,
].map(prefix => new RegExp(`(${prefix})(${IP})`, 'gim'));
// what an echoed address becomes: the addresses set aside for documentation (RFC 5737,
// RFC 3849)
const DOC_IPV4 = '192.0.2.1';
const DOC_IPV6 = '2001:db8::1';
// an address that is nobody's: already a documentation address, or the loopback
const nobodysAddress = (address: string): boolean =>
  /^192\.0\.2\.|^198\.51\.100\.|^203\.0\.113\.|^127\.|^2001:db8:|^::1$/i.test(address);

// Replace the address a server said the request came from. Safe to run again: a
// documentation address is left as it is
export function replaceRequestAddresses(text: string): { text: string; replaced: number } {
  let replaced = 0;
  let result = text;
  for (const pattern of CLIENT_ECHO) {
    result = result.replace(pattern, (whole: string, prefix: string, address: string) => {
      if (nobodysAddress(address)) return whole;
      replaced++;
      return prefix + (address.includes(':') ? DOC_IPV6 : DOC_IPV4);
    });
  }
  return { text: result, replaced };
}

// whether two versions of a response parse to the same fields and the same kind of answer
export function parsesTheSame(raw: string, changed: string, server: string): boolean {
  const [before, after] = [raw, changed].map(text =>
    parseBlocks(stripRawMetadata(text), server, DOMAIN_QUERY_TYPE)
  );
  return (
    JSON.stringify(before.data) === JSON.stringify(after.data) && before.status === after.status
  );
}
