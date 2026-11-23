import ipaddr from 'ipaddr.js';

// which IP addresses count as public: the only ones the library connects to unless the
// target policy allows private hosts. Everything else is refused, whatever name led to it:
// loopback, private and shared (CGNAT) space, link-local (cloud metadata at
// 169.254.169.254 and fe80::/10), unique-local, multicast, broadcast, unspecified,
// documentation, benchmarking and reserved ranges.
//
// an IPv6 address that carries an IPv4 address the way a host would reach it (IPv4-mapped
// ::ffff:0:0/96, and the NAT64 prefix 64:ff9b::/96) is judged by that IPv4 address. Other
// transition forms (6to4, Teredo, IPv4-translated, the local-use NAT64 prefix and the
// deprecated IPv4-compatible ::/96) are refused outright: no registry server is reached
// that way, and each hides an IPv4 address a gateway may forward to

const GLOBAL_UNICAST = ipaddr.IPv6.parseCIDR('2000::/3');
const NAT64 = ipaddr.IPv6.parseCIDR('64:ff9b::/96');

// the address in an IP literal, or null when the text is not one. A URL writes an IPv6
// address in brackets; a zone id (fe80::1%eth0) is not a public address and is refused
function parseAddress(text: string): ipaddr.IPv4 | ipaddr.IPv6 | null {
  const literal = text.replace(/^\[(.*)\]$/, '$1');
  if (!ipaddr.isValid(literal)) return null;
  // ipaddr also reads the shorthand forms inet_aton takes (127.1, 0x7f.1, 2130706433);
  // only the four-part dotted form and IPv6 count as literals, so those are refused as
  // hosts by the name check instead
  if (ipaddr.IPv4.isValidFourPartDecimal(literal) || ipaddr.IPv6.isValid(literal)) {
    return ipaddr.parse(literal);
  }
  return null;
}

// whether `text` is an IP address literal (IPv4 dotted, or IPv6 with or without brackets)
export function isIpLiteral(text: string): boolean {
  return parseAddress(text) !== null;
}

// whether an IP address is one the library may connect to by default. Text that is not an
// IP address is not public
export function isPublicAddress(text: string): boolean {
  const address = parseAddress(text);
  if (!address) return false;
  if (address.kind() === 'ipv4') return address.range() === 'unicast';

  const v6 = address as ipaddr.IPv6;
  if (v6.zoneId) return false;
  if (v6.isIPv4MappedAddress()) return v6.toIPv4Address().range() === 'unicast';
  if (v6.match(NAT64)) {
    const bytes = v6.toByteArray();
    return new ipaddr.IPv4(bytes.slice(12)).range() === 'unicast';
  }
  return v6.match(GLOBAL_UNICAST) && v6.range() === 'unicast';
}
