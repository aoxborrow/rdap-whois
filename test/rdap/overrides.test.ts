import { describe, expect, it } from 'vitest';
import { DnsServerCache } from '../../src/rdap/cache/dns';
import { applyRdapOverrides } from '../../src/rdap/cache/overrides';

describe('applyRdapOverrides', () => {
  it('adds a route for a TLD the bootstrap does not cover, normalized', () => {
    const cache = new Map<string, string>();
    applyRdapOverrides(cache, { de: 'https://rdap.denic.de' });
    // normalizeRdapServer lowercases, forces https, and adds one trailing slash
    expect(cache.get('de')).toBe('https://rdap.denic.de/');
  });

  it('replaces an existing bootstrap route (later layer wins)', () => {
    const cache = new Map<string, string>([['app', 'https://rdap.old.example/']]);
    applyRdapOverrides(cache, { app: 'https://rdap.new.example/' });
    expect(cache.get('app')).toBe('https://rdap.new.example/');
  });

  it('upgrades http to https and collapses trailing slashes', () => {
    const cache = new Map<string, string>();
    applyRdapOverrides(cache, { ch: 'http://rdap.nic.ch///' });
    expect(cache.get('ch')).toBe('https://rdap.nic.ch/');
  });

  it('lowercases the TLD key', () => {
    const cache = new Map<string, string>();
    applyRdapOverrides(cache, { XN__: 'https://rdap.example/' } as Record<string, string>);
    expect(cache.get('xn__')).toBe('https://rdap.example/');
  });

  it('removes a route when the value is null (retract a dead bootstrap entry)', () => {
    const cache = new Map<string, string>([['zz', 'https://rdap.dead.example/']]);
    applyRdapOverrides(cache, { zz: null });
    expect(cache.has('zz')).toBe(false);
  });

  it('applies discovered then overrides so the owner layer wins (bootstrap ← discovered ← overrides)', () => {
    const cache = new Map<string, string>([['xx', 'https://bootstrap.example/']]);
    applyRdapOverrides(cache, { xx: 'https://discovered.example/' });
    applyRdapOverrides(cache, { xx: 'https://owner.example/' });
    expect(cache.get('xx')).toBe('https://owner.example/');
  });
});

describe('DnsServerCache with empty override layers', () => {
  it('still routes bootstrap TLDs (the committed layers are {} today)', () => {
    const cache = new DnsServerCache();
    // .com is always in the IANA bootstrap; the empty layers must not disturb it
    expect(cache.getServer('example.com')).toBeTruthy();
  });
});
