// which addresses the library connects to: the public ones, judged against the IANA
// special-purpose registries for IPv4 and IPv6, and the forms that carry an IPv4 address.
import { describe, expect, it } from 'vitest';
import { isIpLiteral, isPublicAddress } from '../../src/net/addresses';

describe('isPublicAddress', () => {
  // one address from each block of the IANA IPv4 Special-Purpose Address Registry, and the
  // other blocks that are not globally reachable
  it.each([
    ['0.0.0.0', 'this network'],
    ['0.1.2.3', 'this network'],
    ['10.0.0.1', 'private'],
    ['100.64.0.1', 'shared address space (CGNAT)'],
    ['100.127.255.254', 'shared address space (CGNAT)'],
    ['127.0.0.1', 'loopback'],
    ['127.255.255.254', 'loopback'],
    ['169.254.169.254', 'link-local (cloud metadata)'],
    ['172.16.0.1', 'private'],
    ['172.31.255.254', 'private'],
    ['192.0.0.1', 'IETF protocol assignments'],
    ['192.0.0.170', 'NAT64/DNS64 discovery'],
    ['192.0.2.1', 'documentation (TEST-NET-1)'],
    ['192.31.196.1', 'AS112-v4'],
    ['192.52.193.1', 'AMT'],
    ['192.88.99.1', 'deprecated 6to4 relay anycast'],
    ['192.168.1.1', 'private'],
    ['192.175.48.1', 'direct delegation AS112'],
    ['198.18.0.1', 'benchmarking'],
    ['198.19.255.254', 'benchmarking'],
    ['198.51.100.1', 'documentation (TEST-NET-2)'],
    ['203.0.113.1', 'documentation (TEST-NET-3)'],
    ['224.0.0.1', 'multicast'],
    ['239.255.255.250', 'multicast'],
    ['240.0.0.1', 'reserved'],
    ['255.255.255.255', 'limited broadcast'],
  ])('refuses %s (%s)', address => {
    expect(isPublicAddress(address)).toBe(false);
  });

  // one address from each block of the IANA IPv6 Special-Purpose Address Registry, and the
  // other blocks outside global unicast
  it.each([
    ['::', 'unspecified'],
    ['::1', 'loopback'],
    ['::ffff:127.0.0.1', 'IPv4-mapped loopback'],
    ['::ffff:7f00:1', 'IPv4-mapped loopback, in hex'],
    ['::ffff:169.254.169.254', 'IPv4-mapped link-local'],
    ['::ffff:10.0.0.1', 'IPv4-mapped private'],
    ['::ffff:0:a00:1', 'IPv4-translated'],
    ['::a00:1', 'IPv4-compatible (deprecated)'],
    ['::808:808', 'IPv4-compatible, even of a public address'],
    ['64:ff9b::a9fe:a9fe', 'NAT64 of link-local'],
    ['64:ff9b::7f00:1', 'NAT64 of loopback'],
    ['64:ff9b:1::808:808', 'local-use NAT64'],
    ['100::1', 'discard-only'],
    ['2001::1', 'Teredo'],
    ['2001:2::1', 'benchmarking'],
    ['2001:3::1', 'AMT'],
    ['2001:4:112::1', 'AS112-v6'],
    ['2001:10::1', 'ORCHID (deprecated)'],
    ['2001:20::1', 'ORCHIDv2'],
    ['2001:db8::1', 'documentation'],
    ['2002:a00:1::1', '6to4'],
    ['2620:4f:8000::1', 'direct delegation AS112'],
    ['3fff::1', 'documentation'],
    ['5f00::1', 'segment routing'],
    ['fc00::1', 'unique local'],
    ['fd00::1', 'unique local'],
    ['fe80::1', 'link-local'],
    ['fe80::1%eth0', 'link-local with a zone'],
    ['fec0::1', 'site-local (deprecated)'],
    ['ff02::1', 'multicast'],
    ['4000::1', 'unassigned, outside 2000::/3'],
  ])('refuses %s (%s)', address => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '192.0.32.10',
    '199.7.83.42',
    '::ffff:8.8.8.8',
    '64:ff9b::808:808',
    '2001:500:8f::53',
    '2606:4700:4700::1111',
    '[2606:4700:4700::1111]',
  ])('allows %s', address => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it('refuses text that is not an address', () => {
    expect(isPublicAddress('example.com')).toBe(false);
    expect(isPublicAddress('')).toBe(false);
  });
});

describe('isIpLiteral', () => {
  it('reads dotted IPv4 and IPv6, with or without brackets', () => {
    expect(isIpLiteral('192.0.2.1')).toBe(true);
    expect(isIpLiteral('::1')).toBe(true);
    expect(isIpLiteral('[::1]')).toBe(true);
  });

  it('leaves the shorthand IPv4 forms and names to the resolver', () => {
    expect(isIpLiteral('127.1')).toBe(false);
    expect(isIpLiteral('2130706433')).toBe(false);
    expect(isIpLiteral('whois.example.com')).toBe(false);
  });
});
