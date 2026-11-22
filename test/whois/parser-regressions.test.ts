// §6ah bug-fix coverage: the 6 genuine new-engine regressions the deep corpus sweep surfaced on
// variants the thin fixture corpus never sampled (the block engine was live in prod with these).
// Each case asserts the corrected field on a committed fixture so a future config/engine edit that
// reintroduces the bug fails here — independent of the golden set (some of these goldens still
// carry the OLD engine's own bug and will be rebaselined in Phase 2).
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { DOMAIN_QUERY_TYPE } from '../../src/common/constants';
import { readFixture } from '../../scripts/whois/lib/raw';
import { parseBlocks } from '../../src/whois/mapping';

const FOUND = fileURLToPath(new URL('../../fixtures/whois/found/', import.meta.url));

function parseFixture(server: string, file: string): Record<string, unknown> {
  const raw = readFixture(FOUND + file);
  return parseBlocks(raw, server, DOMAIN_QUERY_TYPE).data as unknown as Record<string, unknown>;
}

describe('§6ah new-engine bug fixes', () => {
  it('nic.ar: FRED handle-ref — creation from domain `registered:`, name from the `contact:` block', () => {
    const d = parseFixture('whois.nic.ar', 'whois.nic.ar___mercadolibre.com.ar.txt');
    // was the contact block's `created: 2013-10-18` before the fix
    expect(d.creationDate).toEqual(new Date('1999-05-11T00:00:00Z'));
    // the handle resolves to the contact's name, not itself
    expect(d.registrantId).toBe('30703088534');
    expect(d.registrantName).toBe('MERCADOLIBRE S.R.L.');
  });

  it('twnic: a Chinese-name + English-org registrant keeps the real 2-letter country', () => {
    const d = parseFixture('whois.twnic.net.tw', 'whois.twnic.net.tw___gamer.com.tw.txt');
    // was the English org line ("Oneup Network Corp.") before strict 2-letter country matching
    expect(d.registrantCountry).toBe('TW');
    expect(d.registrantEmail).toBe('pr@gamer.com.tw');
  });

  it('dns.be: the "Not shown, please visit …" redaction boilerplate is not the registrant name', () => {
    const d = parseFixture('whois.dns.be', 'whois.dns.be___geoedge.be.txt');
    expect(d.registrantName ?? '').not.toMatch(/Not shown/i);
    expect(d.registrantName ?? '').toBe('');
  });

  it('register.si: `registrant: <handle>` is the id; the `Domain holder:` section is the name', () => {
    const d = parseFixture('whois.register.si', 'whois.register.si___bombuj.si.txt');
    expect(d.registrantId).toBe('O1336206');
    expect(d.registrantName).toBe('NOT DISCLOSED'); // NOT the handle
  });

  it('co.ug: updatedDate is `Information Last Updated`, not the `Renewed On` renewal date', () => {
    const d = parseFixture('whois.co.ug', 'whois.co.ug___monitor.co.ug.txt');
    // Renewed On is 2024-06-13; the record-modification stamp is 2024-07-15 10:56:48 at +03:00
    expect(d.updatedDate).toEqual(new Date('2024-07-15T07:56:48Z'));
  });

  it('nc: every numbered `Domain server <n>` is captured, not just the first four', () => {
    const d = parseFixture('whois.nc', 'whois.nc___gouv.nc.txt');
    const ns = d.nameservers as string[];
    expect(ns).toHaveLength(6);
    expect(ns).toContain('ns5.gouv.nc'); // the 5th/6th were dropped by the capped alias list
    expect(ns).toContain('ns-cloud-c4.googledomains.com');
  });
});

describe('server errors', () => {
  it('nic.uk: a name that contravenes the naming rules is an error, not a record', () => {
    const raw = readFixture(
      fileURLToPath(
        new URL(
          '../../fixtures/whois/vendored/weppos/invalid/whois.nic.uk___uk.txt',
          import.meta.url
        )
      )
    );
    expect(parseBlocks(raw, 'whois.nic.uk', DOMAIN_QUERY_TYPE).status).toBe('error');
  });
});
