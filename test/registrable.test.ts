// registrableDomain(), the name lookup() asks about, and detectQueryType() agreeing with
// what lookup() takes for a domain name
import { describe, expect, it } from 'vitest';
import { detectQueryType } from '../src/query';
import { registrableDomain } from '../src/registrable';
import { getServerType } from '../src/rdap/servers';

describe('registrableDomain', () => {
  it('is one label below a TLD', () => {
    expect(registrableDomain('www.google.com')).toBe('google.com');
    expect(registrableDomain('google.com')).toBe('google.com');
    expect(registrableDomain('WWW.Google.COM.')).toBe('google.com');
  });

  it('is one label below a second-level zone on the public suffix list', () => {
    expect(registrableDomain('www.bbc.co.uk')).toBe('bbc.co.uk');
    expect(registrableDomain('www.ox.ac.uk')).toBe('ox.ac.uk');
  });

  it('is one label below a zone only the routing data has', () => {
    // ac.ru and gov.scot have registries of their own, and are not ICANN suffixes
    expect(registrableDomain('www.msu.ac.ru')).toBe('msu.ac.ru');
    expect(registrableDomain('www.parliament.gov.scot')).toBe('parliament.gov.scot');
  });

  it('is one label below a CentralNic-style zone, which the list has as private', () => {
    expect(registrableDomain('mail.example.uk.com')).toBe('example.uk.com');
    expect(registrableDomain('www.example.br.com')).toBe('example.br.com');
  });

  it('does not take a private suffix that no registry runs', () => {
    // github.io is a registered name, not a registry
    expect(registrableDomain('foo.github.io')).toBe('github.io');
  });

  it('is null for a suffix on its own', () => {
    expect(registrableDomain('com')).toBeNull();
    expect(registrableDomain('co.uk')).toBeNull();
    expect(registrableDomain('ac.ru')).toBeNull();
    expect(registrableDomain('br.com')).toBeNull();
  });

  it('takes a TLD nobody runs as a suffix', () => {
    expect(registrableDomain('a.b.invalidtld')).toBe('b.invalidtld');
  });

  it('is in ASCII, and null for what is not a domain name', () => {
    expect(registrableDomain('www.bücher.de')).toBe('xn--bcher-kva.de');
    expect(registrableDomain('192.0.2.1')).toBeNull();
    expect(registrableDomain('not a name')).toBeNull();
  });
});

describe('detectQueryType', () => {
  it('calls any dotted host-shaped name a domain, as lookup() does', () => {
    expect(detectQueryType('foo.invalidtld')).toBe('domain');
    expect(detectQueryType('example.com')).toBe('domain');
    expect(detectQueryType('NET-ARIN')).toBe('entity');
    expect(detectQueryType('192.0.2.1')).toBe('ip');
    expect(detectQueryType('AS15169')).toBe('asn');
  });
});

describe('the RDAP server types', () => {
  it('call only the five RIRs regional', () => {
    expect(getServerType('ip', '192.0.2.1', 'https://rdap.arin.net/registry/')).toBe('regional');
    // AFNIC runs .fr; it is not a regional internet registry
    expect(getServerType('domain', 'google.fr', 'https://rdap.nic.fr/')).toBe('registry');
  });
});
