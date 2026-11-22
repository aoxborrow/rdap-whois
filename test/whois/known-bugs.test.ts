// Parser bugs found against real responses, each pinned to the recorded response that showed
// it. The goldens and the invariants cover them too; these say what each one was.
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DOMAIN_QUERY_TYPE } from '../../src/common/constants';
import { isUsableRecord, whoisRecordHop } from '../../src/record/record';
import type { WhoisDomainData } from '../../src/whois/data-types';
import { readFixture } from '../../scripts/whois/lib/raw';
import { parseBlocks } from '../../src/whois/mapping';

const ROOT = fileURLToPath(new URL('../../fixtures/whois/', import.meta.url));

// a fixture `<lane>/<server>___<query>`, parsed
function parse(path: string) {
  const [, base] = path.split('/');
  const server = base.slice(0, base.indexOf('___'));
  const query = base.slice(base.indexOf('___') + '___'.length);
  const result = parseBlocks(readFixture(`${ROOT}${path}.txt`), server, DOMAIN_QUERY_TYPE);
  return { ...result, data: result.data as WhoisDomainData, server, query };
}

describe('known parser bugs', () => {
  it('reads an internationalised .бг name from whois.imena.bg, with its nameservers', () => {
    const { data, query, server } = parse('found/whois.imena.bg___xn----7sbkofbbj4akz.xn--90ae');
    // the line is `DOMAIN NAME: казино-игри.бг (xn----7sbkofbbj4akz.xn--90ae)`
    expect(data.domainName).toBe('казино-игри.бг');
    expect(data.nameservers).toEqual(['jonah.ns.cloudflare.com', 'mimi.ns.cloudflare.com']);
    const hop = whoisRecordHop(query, 'registry', data);
    expect(hop?.record.domainName).toBe(query);
    expect(hop && isUsableRecord(hop.record)).toBe(true);
  });

  it('takes whois.nic.cl’s answer, which does not name the domain, as the record', () => {
    // since 2025 the server answers with no header and no "Domain name:" line
    const { data, query, server } = parse('found/whois.nic.cl___mercadolibre.cl');
    expect(server).toBe('whois.nic.cl');
    expect(data.domainName).toBeNull();
    expect(data.registrarName).toBe('MarkMonitor Inc.');
    const hop = whoisRecordHop(query, 'registry', data);
    expect(hop?.record.domainName).toBe(query);
    expect(hop && isUsableRecord(hop.record)).toBe(true);
  });

  it('keeps the registrar’s expiry apart from the registry’s', () => {
    const { data } = parse('found/coza-whois.registry.net.za___google.co.za');
    expect(data.expirationDate).toEqual(new Date('2027-06-25T20:37:59Z'));
    expect(data.registrarExpirationDate).toEqual(new Date('2027-06-25T20:37:59Z'));
    // a registry that gives only its own has no registrar expiry
    expect(parse('found/ccwhois.verisign-grs.com___arduino.cc').data.registrarExpirationDate).toBe(
      null
    );
  });

  it('reads Identity Digital’s "TLD is not supported." as an error, with no record', () => {
    const { status, data, query } = parse('servfail/whois.nic.gripe___cabura.gripe');
    expect(status).toBe('error');
    const hop = whoisRecordHop(query, 'registry', data);
    expect(hop && isUsableRecord(hop.record)).toBe(false);
  });

  it('reads whois.nic.ch’s refusal of an address as a throttle', () => {
    // whois.nic.li is the same server software; whois.nic.ch has the same rule
    expect(parse('throttled/whois.nic.li___google.li').status).toBe('throttled');
    const refusal = readFixture(`${ROOT}throttled/whois.nic.li___google.li.txt`);
    expect(parseBlocks(refusal, 'whois.nic.ch', DOMAIN_QUERY_TYPE).status).toBe('throttled');
  });

  it('gives no date for a server’s placeholder for "never updated"', () => {
    expect(parse('found/whois.cdmon.com___boqueria.barcelona').data.updatedDate).toBeNull();
    expect(parse('found/whois.namecheap.com___urlowl.com').data.updatedDate).toBeNull();
  });

  it('takes only the name from whois.hkirc.hk’s line with the bundled Chinese name', () => {
    expect(parse('found/whois.hkirc.hk___baidu.hk').data.domainName).toBe('baidu.hk');
  });

  it('does not read whois.nic.tm’s glue addresses as nameservers', () => {
    const { nameservers } = parse('found/whois.nic.tm___nic.tm').data;
    expect(nameservers).toContain('dns01.nic.tm');
    expect(nameservers?.some(ns => /^[\d.:a-f]+$/.test(ns))).toBe(false);
  });

  it('tells whois.mediaserv.net’s missing contact from a missing domain', () => {
    // `NO OBJECT FOUND!` stands in for each contact of a registered name
    const registered = parse('found/whois.mediaserv.net___nic.mq');
    expect(registered.status).toBe('found');
    expect(registered.data.registrantName).toBeNull();
    // and is the whole answer for a name it does not have
    expect(parse('notfound/whois.mediaserv.net___notfound-testing-sorry.gf').status).toBe(
      'notfound'
    );
  });
});
