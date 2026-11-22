// A few lookups against real servers, to show the library works end to end on its own:
// routing data, sockets, fetch, referrals, parsing and the combined record.
//
// Skipped unless LIVE=1, so the unit run needs no network:
//   LIVE=1 npm test -- test/live.test.ts
//
// Only things that do not rotate are pinned: creation dates and which server answered.
// One name per TLD, so one registry having a bad day costs one case.
import { describe, expect, it } from 'vitest';
import { RdapWhois } from '../src/index';

const LIVE = process.env.LIVE === '1';

describe.skipIf(!LIVE)('live lookups', { timeout: 60_000 }, () => {
  const client = new RdapWhois({ userAgent: 'rdap-whois live tests' });

  it('looks a .com up over RDAP', async () => {
    const { record, source, attempts } = await client.lookup('example.com', { verbose: true });
    expect(record).toMatchObject({ available: false, reserved: false });
    expect(record.domainName).toBe('example.com');
    expect(record.creationDate?.toISOString()).toBe('1995-08-14T04:00:00.000Z');
    expect(record.expirationDate).toBeInstanceOf(Date);
    expect(record.nameservers?.length).toBeGreaterThan(0);
    expect(source?.protocol).toBe('rdap');
    expect(source?.serverType).toBe('registry');
    expect(attempts.map(attempt => attempt.protocol)).toEqual(['rdap']);
  });

  it('looks a name up over WHOIS where the TLD has no RDAP server', async () => {
    const { record, source } = await client.lookup('nic.io');
    expect(record).toMatchObject({ available: false, reserved: false });
    expect(record.domainName).toBe('nic.io');
    expect(record.nameservers?.length).toBeGreaterThan(0);
    expect(source?.protocol).toBe('whois');
  });

  it('reports a name the registry has no record of as available', async () => {
    const { record, source } = await client.lookup('this-name-should-not-exist-482913.org');
    expect(record).toMatchObject({ available: true, reserved: false });
    expect(record.creationDate).toBeNull();
    expect(source?.serverType).toBe('registry');
  });

  it('follows a WHOIS referral from the registry to the registrar', async () => {
    const hops = await client.whois('wikipedia.net');
    expect(hops.length).toBe(2);
    expect(hops[0].serverType).toBe('registry');
    expect(hops[0].status).toBe('found');
    expect(hops[1].serverType).toBe('registrar');
    expect(hops[1].raw).toBeTruthy();
  });

  it('follows an RDAP referral from the registry to the registrar', async () => {
    const hops = await client.rdap('wikipedia.info');
    expect(hops[0].serverType).toBe('registry');
    expect(hops[0].status).toBe('found');
    expect(hops[0].httpStatus).toBe(200);
    expect(hops.length).toBe(2);
    expect(hops[1].serverType).toBe('registrar');
  });

  it('looks an IP address and an AS number up over RDAP', async () => {
    const [ip] = await client.rdap('8.8.8.8');
    expect(ip.status).toBe('found');
    expect(ip.data).toMatchObject({ objectClassName: 'ip network' });
    const [asn] = await client.rdap('AS15169');
    expect(asn.status).toBe('found');
    expect(asn.data).toMatchObject({ objectClassName: 'autnum' });
  });

  it('looks many names up at once and keeps the order they were given in', async () => {
    const names = ['iana.org', 'this-name-should-not-exist-482913.net', 'nic.de'];
    const items = await client.lookupAll(names);
    expect(items.map(item => item.query)).toEqual(names);
    expect(items.map(item => item.ok && item.result.record.available)).toEqual([
      false,
      true,
      false,
    ]);
  });

  // a smoke list across the kinds of name lookup() has got wrong before: a host, GoDaddy's
  // registrar RDAP (silent from cloud addresses), Google Registry's DNSSEC, .uk's zones,
  // .ru, IDNs, a registrar that sends no statuses, and names nobody holds
  const SMOKE: [asked: string, query: string, available: boolean][] = [
    ['www.google.com', 'google.com', false],
    ['www.bbc.co.uk', 'bbc.co.uk', false],
    ['godaddy.com', 'godaddy.com', false],
    ['wix.com', 'wix.com', false],
    ['opera.com', 'opera.com', false],
    ['name.com', 'name.com', false],
    ['google.dev', 'google.dev', false],
    ['amazon.dev', 'amazon.dev', false],
    ['nominet.uk', 'nominet.uk', false],
    ['www.ox.ac.uk', 'ox.ac.uk', false],
    ['yandex.ru', 'yandex.ru', false],
    ['www.msu.ru', 'msu.ru', false],
    ['яндекс.рф', 'xn--d1acpjx3f.xn--p1ai', false],
    ['bücher.de', 'xn--bcher-kva.de', false],
    ['google.com.au', 'google.com.au', false],
    ['google.nl', 'google.nl', false],
    ['foo.github.io', 'github.io', false],
    ['this-name-should-not-exist-482913.com', 'this-name-should-not-exist-482913.com', true],
    ['this-name-should-not-exist-482913.co.uk', 'this-name-should-not-exist-482913.co.uk', true],
    ['this-name-should-not-exist-482913.dev', 'this-name-should-not-exist-482913.dev', true],
  ];

  it.each(SMOKE)('smoke: %s is looked up as %s', async (asked, query, available) => {
    const { record, query: lookedUp } = await client.lookup(asked);
    expect(lookedUp).toBe(query);
    expect(record.available).toBe(available);
    // DENIC and auDA publish no creation date, so the delegation is what every one has
    if (!available) expect(record.nameservers?.length).toBeGreaterThan(0);
  });

  it('smoke: takes the registry’s answer for what it holds', async () => {
    // Google Registry sends zoneSigned: true for unsigned names
    expect((await client.lookup('google.dev')).record.dnssec).toBe(false);
    // the registrar's own date is the 2017 transfer; Verisign has 1999
    expect((await client.lookup('opera.com')).record.creationDate?.getUTCFullYear()).toBe(1999);
    // auDA's registrar handle is not MarkMonitor's IANA ID
    expect((await client.lookup('google.com.au')).record.registrar?.ianaId).not.toBe(802247);
  });
});
