// reviveDates(): what JSON made strings comes back as Dates, by field name only.
import { describe, expect, it } from 'vitest';
import { RdapWhois } from '../src/client';
import type { CacheKey, CachedHops } from '../src/core';
import type { RdapHop } from '../src/rdap/client';
import type { RdapResponse } from '../src/rdap/types';
import { reviveDates } from '../src/revive';
import type { WhoisHop } from '../src/whois/client';
import type { WhoisDataType } from '../src/whois/data-types';

const roundTrip = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

// an RDAP answer with too little in it to use, so lookup() goes on to WHOIS
const thinRdap: RdapHop = {
  server: 'https://rdap.verisign.com/com/v1/',
  serverType: 'registry',
  url: 'https://rdap.verisign.com/com/v1/domain/example.com',
  status: 'found',
  httpStatus: 200,
  data: {
    rdapConformance: ['rdap_level_0'],
    objectClassName: 'domain',
    ldhName: 'EXAMPLE.COM',
    // a server's own field that looks like a date, which is not the library's to change
    port43: '2024-01-01T00:00:00Z',
  } as unknown as RdapResponse,
  tries: 1,
  elapsed: 4,
};

// any of a hop's fields, without the pairing `status` holds them to
type WhoisHopFields = { [K in keyof WhoisHop]?: WhoisHop[K] };

const whoisHop = (overrides: WhoisHopFields, data: Record<string, unknown>): WhoisHop =>
  ({
    server: 'whois.verisign-grs.com',
    serverType: 'registry',
    queryString: 'example.com',
    status: 'found',
    raw: 'Domain Name: EXAMPLE.COM',
    data: {
      domainName: 'example.com',
      creationDate: new Date('1995-08-14T04:00:00Z'),
      expirationDate: new Date('2027-08-13T04:00:00Z'),
      updatedDate: new Date('2024-08-14T07:01:34Z'),
      registrarName: 'Example Registrar, Inc.',
      registrarId: '9999',
      nameservers: ['a.iana-servers.net', 'b.iana-servers.net'],
      ...data,
    } as unknown as WhoisDataType,
    tries: 1,
    elapsed: 5,
    ...overrides,
  }) as WhoisHop;

const whoisRegistry = whoisHop({}, {});
const whoisRegistrar = whoisHop(
  { server: 'whois.example-registrar.com', serverType: 'unknown' },
  {
    // a day and more apart from the registry's, so the two disagree
    creationDate: new Date('1995-08-10T00:00:00Z'),
    registrarExpirationDate: new Date('2026-08-13T04:00:00Z'),
    registrantName: '2024-01-01',
  }
);

// a lookup whose protocol lookups are answered with the hops given
async function lookupResult() {
  const hops: Record<string, CachedHops> = {
    rdap: [thinRdap],
    whois: [whoisRegistry, whoisRegistrar],
  };
  const client = new RdapWhois({
    cache: { get: (key: CacheKey) => hops[key.protocol], set: () => {} },
  });
  return client.lookup('example.com', { verbose: true });
}

describe('reviveDates', () => {
  it('gives back a lookup result that went through JSON, with both protocols', async () => {
    const result = await lookupResult();
    // the case covers every place a date is
    expect(result.attempts.map(attempt => attempt.protocol)).toEqual(['rdap', 'whois']);
    expect(result.record.registryExpirationDate).toBeInstanceOf(Date);
    expect(result.record.expirationDate).toBeInstanceOf(Date);
    expect(result.record.updatedDate).toBeInstanceOf(Date);
    expect(result.discrepancies).toContainEqual(
      expect.objectContaining({ field: 'creationDate', registry: expect.any(Date) })
    );

    const revived = reviveDates(roundTrip(result));
    expect(revived).toEqual(result);
    expect(revived.record.creationDate).toBeInstanceOf(Date);
  });

  it('gives back hops, one hop, a record and a lookupMany() item', async () => {
    const result = await lookupResult();
    const whois = [whoisRegistry, whoisRegistrar];
    expect(reviveDates(roundTrip(whois))).toEqual(whois);
    expect(reviveDates(roundTrip([thinRdap]))).toEqual([thinRdap]);
    expect(reviveDates(roundTrip(whoisRegistrar))).toEqual(whoisRegistrar);
    expect(reviveDates(roundTrip(result.record))).toEqual(result.record);
    const item = { query: 'example.com', result };
    expect(reviveDates(roundTrip(item))).toEqual(item);
  });

  it('gives back a lookup result that is not verbose', async () => {
    const { query, record, source } = await lookupResult();
    const slim = { query, record, source };
    const revived = reviveDates(roundTrip(slim));
    expect(revived).toEqual(slim);
    expect(revived.record.expirationDate).toBeInstanceOf(Date);
  });

  it('changes only the library’s date fields', () => {
    const [registry, registrar] = reviveDates(roundTrip([thinRdap, whoisRegistrar])) as [
      RdapHop,
      WhoisHop,
    ];
    expect((registry.data as unknown as { port43: unknown }).port43).toBe('2024-01-01T00:00:00Z');
    expect((registrar.data as unknown as { registrantName: unknown }).registrantName).toBe(
      '2024-01-01'
    );
  });

  it('leaves what it was given alone, and what is not a date string as it is', () => {
    const parsed = roundTrip(whoisRegistry);
    const revived = reviveDates(parsed);
    expect(typeof (parsed.data as unknown as { creationDate: unknown }).creationDate).toBe(
      'string'
    );
    // already revived: unchanged
    expect(reviveDates(revived)).toEqual(revived);
    const odd = { ...parsed, data: { ...parsed.data, expirationDate: 'not a date' } };
    expect((reviveDates(odd).data as unknown as { expirationDate: unknown }).expirationDate).toBe(
      'not a date'
    );
    expect(reviveDates(null)).toBeNull();
    expect(reviveDates('2024-01-01')).toBe('2024-01-01');
  });
});
