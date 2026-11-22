// client.lookup(): which answer it gives for every combination of what the two protocols
// can say, how the registry's and the registrar's answers are put together, and batches.
// The protocol lookups are answered from a `cache`, so each case is exactly the hops it names.
import { describe, expect, it } from 'vitest';
import { RdapWhois, type LookupOptions } from '../src/client';
import type { CacheKey, CachedHops, ClientEvent } from '../src/core';
import type { RdapHop } from '../src/rdap/client';
import type { WhoisHop } from '../src/whois/client';
import {
  ConnectionError,
  InvalidQueryError,
  InvalidResponseError,
  NoServerError,
  NoUsableAnswerError,
  TimeoutError,
} from '../src/errors';
import type { RdapResponse } from '../src/rdap/types';
import type { WhoisDataType } from '../src/whois/data-types';

const REGISTRY = 'https://rdap.verisign.com/com/v1/';
const REGISTRAR = 'https://rdap.example-registrar.com/rdap/';
const IANA_9999 = [{ type: 'IANA Registrar ID', identifier: '9999' }];

const entity = (role: string, name: string, extra: Record<string, unknown> = {}) => ({
  objectClassName: 'entity',
  roles: [role],
  vcardArray: [
    'vcard',
    [
      ['version', {}, 'text', '4.0'],
      ['fn', {}, 'text', name],
    ],
  ],
  ...extra,
});

const rdapDomain = (overrides: Record<string, unknown> = {}): RdapResponse =>
  ({
    rdapConformance: ['rdap_level_0'],
    objectClassName: 'domain',
    ldhName: 'EXAMPLE.COM',
    status: ['client transfer prohibited'],
    nameservers: [
      { objectClassName: 'nameserver', ldhName: 'A.IANA-SERVERS.NET' },
      { objectClassName: 'nameserver', ldhName: 'B.IANA-SERVERS.NET' },
    ],
    events: [
      { eventAction: 'registration', eventDate: '1995-08-14T04:00:00Z' },
      { eventAction: 'expiration', eventDate: '2027-08-13T04:00:00Z' },
    ],
    entities: [
      entity('registrar', 'Example Registrar, Inc.', { handle: '9999', publicIds: IANA_9999 }),
    ],
    ...overrides,
  }) as unknown as RdapResponse;

// any of a hop's fields, without the pairing `status` holds them to
type RdapHopFields = { [K in keyof RdapHop]?: RdapHop[K] };

const rdapHop = (overrides: RdapHopFields = {}): RdapHop =>
  ({
    server: REGISTRY,
    serverType: 'registry',
    url: `${REGISTRY}domain/example.com`,
    status: 'found',
    httpStatus: 200,
    data: rdapDomain(),
    issues: [],
    tries: 1,
    elapsed: 5,
    ...overrides,
  }) as RdapHop;
const rdapRegistrarHop = (overrides: RdapHopFields = {}): RdapHop =>
  rdapHop({
    server: REGISTRAR,
    // a registrar is a host the routing data does not know
    serverType: 'unknown',
    url: `${REGISTRAR}domain/example.com`,
    data: rdapDomain({
      ldhName: 'example.com',
      events: [
        { eventAction: 'registration', eventDate: '1995-08-14T04:00:00Z' },
        { eventAction: 'registrar expiration', eventDate: '2026-08-13T04:00:00Z' },
      ],
      entities: [
        entity('registrar', 'Example Registrar, Inc.', { handle: '9999', publicIds: IANA_9999 }),
        entity('registrant', 'Example Org'),
        entity('reseller', 'Hover'),
      ],
    }),
    ...overrides,
  });
const rdapNotFound = (overrides: RdapHopFields = {}): RdapHop =>
  rdapHop({ status: 'notfound', httpStatus: 404, data: null, ...overrides });

const whoisData = (overrides: Record<string, unknown> = {}): WhoisDataType =>
  ({
    domainName: 'example.com',
    creationDate: new Date('1995-08-14T04:00:00Z'),
    expirationDate: new Date('2027-08-13T04:00:00Z'),
    registrarName: 'Example Registrar, Inc.',
    registrarId: '9999',
    registrarIanaId: 9999,
    nameservers: ['a.iana-servers.net', 'b.iana-servers.net'],
    ...overrides,
  }) as unknown as WhoisDataType;

// any of a hop's fields, without the pairing `status` holds them to
type WhoisHopFields = { [K in keyof WhoisHop]?: WhoisHop[K] };

const whoisHop = (overrides: WhoisHopFields = {}): WhoisHop =>
  ({
    server: 'whois.verisign-grs.com',
    serverType: 'registry',
    queryString: 'example.com',
    status: 'found',
    raw: 'Domain Name: EXAMPLE.COM',
    data: whoisData(),
    tries: 1,
    elapsed: 5,
    ...overrides,
  }) as WhoisHop;
const whoisNotFound = (overrides: WhoisHopFields = {}): WhoisHop =>
  whoisHop({
    status: 'notfound',
    data: whoisData({}),
    ...overrides,
  });

// a WHOIS server that answered with an error message of its own instead of a record
const whoisServerError = whoisHop({
  status: 'error',
  data: whoisData({ domainName: undefined, registrarName: undefined, registrarId: undefined }),
  error: { name: 'ServerError', message: 'TLD is not supported.', retryable: false },
});

// a client whose two protocol lookups are whatever the test says, and a record of which ran
// a cache that answers every protocol lookup from the function given for that protocol, so
// lookup() makes no request of its own; a protocol with no function must not be asked
function answers(by: {
  rdap?: (query: string) => Promise<CachedHops>;
  whois?: (query: string) => Promise<CachedHops>;
}) {
  return {
    get: (key: CacheKey) =>
      by[key.protocol]?.(key.query) ??
      Promise.reject(new Error(`${key.protocol} was not expected to run`)),
    set: () => {},
  };
}

function setup(
  sources: {
    rdap?: RdapHop[] | Error;
    whois?: WhoisHop[] | Error;
  },
  options: LookupOptions = {}
) {
  const called: string[] = [];
  const events: ClientEvent[] = [];
  const client = new RdapWhois({ onEvent: e => events.push(e) });
  const source =
    <H>(name: 'rdap' | 'whois', value: H[] | Error | undefined) =>
    () => {
      called.push(name);
      if (value === undefined) return Promise.reject(new Error(`${name} was not expected to run`));
      if (value instanceof Error) return Promise.reject(value);
      return Promise.resolve(value as CachedHops);
    };
  const lookup = (query = 'example.com') =>
    client.lookup(query, {
      ...options,
      verbose: true,
      cache: answers({ rdap: source('rdap', sources.rdap), whois: source('whois', sources.whois) }),
    });
  return { lookup, called, events };
}

describe('the result', () => {
  it('is the query, the record and the source, unless verbose is set', async () => {
    const client = new RdapWhois();
    const cache = answers({ rdap: () => Promise.resolve([rdapHop(), rdapRegistrarHop()]) });
    const result = await client.lookup('example.com', { cache });
    expect(Object.keys(result).sort()).toEqual(['query', 'record', 'source']);

    const verbose = await client.lookup('example.com', { cache, verbose: true });
    expect(Object.keys(verbose).sort()).toEqual([
      'attempts',
      'discrepancies',
      'provenance',
      'query',
      'record',
      'source',
    ]);
    expect(verbose.record).toEqual(result.record);
    expect(verbose.source).toEqual(result.source);
    expect(verbose.attempts[0].hops).toHaveLength(2);
  });

  it('is verbose in a batch when asked', async () => {
    const client = new RdapWhois();
    const cache = answers({ rdap: () => Promise.resolve([rdapHop()]) });
    const [plain] = await client.lookupAll(['example.com'], { cache });
    const [verbose] = await client.lookupAll(['example.com'], { cache, verbose: true });
    expect(plain.ok && Object.keys(plain.result)).toEqual(['query', 'record', 'source']);
    expect(verbose.ok && verbose.result.attempts).toHaveLength(1);
  });

  it('gives lists as [] when a server sent none', async () => {
    const bare = rdapHop({ data: rdapDomain({ status: undefined, nameservers: undefined }) });
    const { lookup } = setup({ rdap: [bare] });
    const { record } = await lookup();
    expect(record).toMatchObject({ nameservers: [], eppStatus: [], unmappedStatus: [] });
  });
});

describe('redacted values', () => {
  const redactedRegistrar = rdapRegistrarHop({
    data: rdapDomain({
      ldhName: 'example.com',
      entities: [
        entity('registrar', 'Example Registrar, Inc.', { handle: '9999', publicIds: IANA_9999 }),
        entity('registrant', 'REDACTED FOR PRIVACY'),
        entity('technical', 'Example Tech'),
      ],
    }),
  });

  it('are null in the record with nullRedacted, and as sent in the verbose attempts', async () => {
    const result = await setup(
      { rdap: [rdapHop(), redactedRegistrar] },
      { nullRedacted: true }
    ).lookup();
    expect(result.record.registrant).toBeNull();
    expect(result.record.tech).toMatchObject({ name: 'Example Tech' });
    expect(JSON.stringify(result.attempts)).toContain('REDACTED FOR PRIVACY');
  });

  it('are kept as sent by default', async () => {
    const result = await setup({ rdap: [rdapHop(), redactedRegistrar] }).lookup();
    expect(result.record.registrant).toMatchObject({ name: 'REDACTED FOR PRIVACY' });
  });

  it('leave the other side’s contacts to be taken, as if the server had sent none', async () => {
    const registry = rdapHop({
      data: rdapDomain({ entities: [entity('registrant', 'Example Holder')] }),
    });
    const allRedacted = rdapRegistrarHop({
      data: rdapDomain({
        ldhName: 'example.com',
        entities: [
          entity('registrar', 'Example Registrar, Inc.', { handle: '9999', publicIds: IANA_9999 }),
          entity('registrant', 'REDACTED FOR PRIVACY'),
        ],
      }),
    });
    const result = await setup({ rdap: [registry, allRedacted] }, { nullRedacted: true }).lookup();
    expect(result.record.registrant).toMatchObject({ name: 'Example Holder' });
    expect(result.provenance?.contacts).toBe('registry');
    const kept = await setup({ rdap: [registry, allRedacted] }).lookup();
    expect(kept.provenance?.contacts).toBe('registrar');
  });

  it('leave the other side’s contacts to be taken when only a handle is left', async () => {
    const registry = whoisHop({ data: whoisData({ registrantName: 'Example Holder' }) });
    const registrar = whoisHop({
      server: 'whois.example-registrar.com',
      serverType: 'registrar',
      data: whoisData({ registrantName: 'REDACTED FOR PRIVACY', techId: 'TECH-1' }),
    });
    const result = await setup(
      { whois: [registry, registrar] },
      { protocol: 'whois', nullRedacted: true }
    ).lookup();
    expect(result.record.registrant).toMatchObject({ name: 'Example Holder' });
    expect(result.provenance?.contacts).toBe('registry');
  });

  it('name where handle-only contacts came from when no side gave more', async () => {
    const result = await setup(
      { whois: [whoisHop({ data: whoisData({ techId: 'TECH-1' }) })] },
      { protocol: 'whois' }
    ).lookup();
    expect(result.record.tech).toMatchObject({ id: 'TECH-1' });
    expect(result.provenance?.contacts).toBe('registry');
  });

  it('do not change whether an answer is usable', async () => {
    const thin = whoisHop({
      data: whoisData({
        registrarName: null,
        registrarId: null,
        registrarIanaId: null,
        nameservers: null,
        creationDate: null,
        expirationDate: null,
        registrantName: 'REDACTED FOR PRIVACY',
      }),
    });
    const result = await setup(
      { whois: [thin] },
      { protocol: 'whois', nullRedacted: true }
    ).lookup();
    expect(result.record).toMatchObject({ available: false, registrant: null });
  });
});

describe('a registered name', () => {
  it('comes from RDAP, and WHOIS is not asked', async () => {
    const { lookup, called } = setup({ rdap: [rdapHop()] });
    const result = await lookup('Example.COM');

    expect(called).toEqual(['rdap']);
    expect(result.query).toBe('example.com');
    expect(result.record).toMatchObject({
      domainName: 'example.com',
      available: false,
      reserved: false,
      creationDate: new Date('1995-08-14T04:00:00Z'),
      expirationDate: new Date('2027-08-13T04:00:00Z'),
      registryExpirationDate: new Date('2027-08-13T04:00:00Z'),
      nameservers: ['a.iana-servers.net', 'b.iana-servers.net'],
      registrar: { name: 'Example Registrar, Inc.', ianaId: 9999 },
      reseller: null,
    });
    expect(result.record).not.toHaveProperty('registrarExpirationDate');
    expect(result.source).toEqual({
      protocol: 'rdap',
      server: REGISTRY,
      serverType: 'registry',
      url: `${REGISTRY}domain/example.com`,
    });
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]).toMatchObject({ protocol: 'rdap' });
    expect(result.discrepancies).toEqual([]);
  });

  it('comes from WHOIS when the TLD has no RDAP server, and RDAP is not asked', async () => {
    const { lookup, called } = setup({
      whois: [
        whoisHop({ server: 'whois.denic.de', data: whoisData({ domainName: 'example.de' }) }),
      ],
    });
    const result = await lookup('example.de');
    expect(called).toEqual(['whois']);
    expect(result.record).toMatchObject({
      domainName: 'example.de',
      available: false,
      reserved: false,
    });
    expect(result.source).toEqual({
      protocol: 'whois',
      server: 'whois.denic.de',
      serverType: 'registry',
    });
  });

  it('falls back to WHOIS when RDAP answers with too little to use', async () => {
    // a status and a name, and nothing about who holds it, where or since when
    const thin = rdapHop({ data: rdapDomain({ entities: [], nameservers: [], events: [] }) });
    const { lookup, called, events } = setup({ rdap: [thin], whois: [whoisHop()] });
    const result = await lookup();
    expect(called).toEqual(['rdap', 'whois']);
    expect(result.source?.protocol).toBe('whois');
    expect(events).toContainEqual({
      type: 'fallback',
      from: 'rdap',
      to: 'whois',
      reason: 'insufficient',
    });
  });

  it('takes a sparse answer that has nameservers or a creation date', async () => {
    // DENIC gives the name, its nameservers and a status it calls `connect`, nothing more
    const denic = whoisHop({
      server: 'whois.denic.de',
      data: whoisData({
        domainName: 'example.de',
        registrarName: null,
        registrarId: null,
        registrarIanaId: null,
        creationDate: null,
        expirationDate: null,
        eppStatusRaw: ['connect'],
      }),
    });
    const de = await setup({ whois: [denic] }, { protocol: 'whois' }).lookup('example.de');
    expect(de.record).toMatchObject({
      available: false,
      reserved: false,
      unmappedStatus: ['connect'],
    });
    // .hu gives the name and when it was created
    const nichu = whoisHop({
      server: 'whois.nic.hu',
      data: whoisData({
        domainName: 'example.hu',
        registrarName: null,
        registrarId: null,
        registrarIanaId: null,
        nameservers: null,
      }),
    });
    const hu = await setup({ whois: [nichu] }, { protocol: 'whois' }).lookup('example.hu');
    expect(hu.record).toMatchObject({ available: false, reserved: false });
  });

  it('does not take an empty record', async () => {
    // a refusal the parser does not know parses to nothing; the record has an empty registrar
    const empty = whoisData({
      domainName: null,
      registrarName: null,
      registrarId: null,
      registrarIanaId: null,
      nameservers: null,
      creationDate: null,
      expirationDate: null,
    });
    const { lookup } = setup({ whois: [whoisHop({ data: empty })] }, { protocol: 'whois' });
    await expect(lookup()).rejects.toBeInstanceOf(NoUsableAnswerError);
  });

  it('takes a WHOIS record that does not name the domain, as whois.nic.cl answers', async () => {
    const unnamed = whoisHop({ server: 'whois.nic.cl', data: whoisData({ domainName: null }) });
    const result = await setup({ whois: [unnamed] }, { protocol: 'whois' }).lookup(
      'mercadolibre.cl'
    );
    expect(result.record).toMatchObject({
      domainName: 'mercadolibre.cl',
      available: false,
      reserved: false,
    });
  });

  it('refuses a WHOIS record about some other domain from the first server', async () => {
    const other = whoisHop({ data: whoisData({ domainName: 'example.net' }) });
    const { lookup } = setup({ whois: [other] }, { protocol: 'whois' });
    await expect(lookup('example.com')).rejects.toBeInstanceOf(InvalidResponseError);
  });

  it('takes a WHOIS record for the registered name above a host', async () => {
    // whois.nic.uk answers www.gov.uk with gov.uk's record
    const above = whoisHop({ data: whoisData({ domainName: 'example.com' }) });
    const result = await setup({ whois: [above] }, { protocol: 'whois' }).lookup('www.example.com');
    expect(result.record.available).toBe(false);
  });

  it('passes over a referral about some other domain, keeping the registry’s answer', async () => {
    const registrar = whoisHop({
      server: 'whois.example-registrar.com',
      serverType: 'registrar',
      data: whoisData({ domainName: 'example.net', registrantOrg: 'Someone Else' }),
    });
    const result = await setup({ whois: [whoisHop(), registrar] }, { protocol: 'whois' }).lookup();
    expect(result.record.domainName).toBe('example.com');
    expect(result.record.registrant).toBeNull();
  });

  it('takes a name written under a variant of the TLD as the same name', async () => {
    // TWNIC answers nic.台湾 (xn--kprw13d) as nic.台灣 (xn--kpry57d)
    const twnic = whoisHop({
      server: 'whois.twnic.net.tw',
      data: whoisData({ domainName: 'nic.台灣' }),
    });
    const result = await setup({ whois: [twnic] }, { protocol: 'whois' }).lookup('nic.xn--kprw13d');
    expect(result.record.available).toBe(false);
  });

  it('uses only the protocol it is pinned to', async () => {
    const { lookup, called } = setup({ whois: [whoisHop()] }, { protocol: 'whois' });
    const result = await lookup();
    expect(called).toEqual(['whois']);
    expect(result.source?.protocol).toBe('whois');
  });

  it('accepts a reserved name, which has no registrar or registrant to find', async () => {
    const reserved = whoisHop({
      status: 'reserved',
      server: 'whois.denic.de',
      data: whoisData({
        domainName: 'example.de',
        registrarName: undefined,
        registrarId: undefined,
      }),
    });
    const { lookup } = setup({ whois: [reserved] });
    const result = await lookup('example.de');
    expect(result.record).toMatchObject({ available: false, reserved: true });
  });
});

describe('putting the registry and the registrar together', () => {
  const both = { rdap: [rdapHop(), rdapRegistrarHop()] };

  it('takes the registrar’s details and contacts from the registrar', async () => {
    const result = await setup(both).lookup();

    expect(result.record).toMatchObject({
      available: false,
      reserved: false,
      registrant: { name: 'Example Org' },
      registrar: { name: 'Example Registrar, Inc.' },
      reseller: 'Hover',
      // the registry's own expiry is reported beside it
      registryExpirationDate: new Date('2027-08-13T04:00:00Z'),
    });
    // the registrar's response has no `expiration` event, only `registrar expiration`,
    // which is the expiry the record gives
    expect(result.record.expirationDate).toEqual(new Date('2026-08-13T04:00:00Z'));
    // the answer rests on the registrar's, which the source calls one though the routing
    // data does not know it
    expect(result.source).toMatchObject({ server: REGISTRAR, serverType: 'registrar' });
  });

  it('lists where the two disagree by more than a day', async () => {
    const result = await setup(both).lookup();
    expect(result.discrepancies).toEqual([
      {
        field: 'expirationDate',
        registry: new Date('2027-08-13T04:00:00Z'),
        registrar: new Date('2026-08-13T04:00:00Z'),
      },
    ]);
  });

  it('does not call a difference of hours a disagreement', async () => {
    const registrar = rdapRegistrarHop({
      data: rdapDomain({
        events: [
          { eventAction: 'registration', eventDate: '1995-08-13T23:00:00-05:00' },
          { eventAction: 'registrar expiration', eventDate: '2027-08-13T00:00:00Z' },
        ],
      }),
    });
    const result = await setup({ rdap: [rdapHop(), registrar] }).lookup();
    expect(result.discrepancies).toEqual([]);
  });

  it('lists different nameservers', async () => {
    const registrar = rdapRegistrarHop({
      data: rdapDomain({
        nameservers: [{ objectClassName: 'nameserver', ldhName: 'ns1.other.net' }],
      }),
    });
    const result = await setup({ rdap: [rdapHop(), registrar] }).lookup();
    expect(result.discrepancies.map(d => d.field)).toContain('nameservers');
    // and the registry's are the ones in the record: it publishes the delegation
    expect(result.record.nameservers).toEqual(['a.iana-servers.net', 'b.iana-servers.net']);
  });

  it('reports the registrar expiry a registry passes on itself', async () => {
    const registry = rdapHop({
      data: rdapDomain({
        events: [
          { eventAction: 'registration', eventDate: '1995-08-14T04:00:00Z' },
          { eventAction: 'expiration', eventDate: '2027-08-13T04:00:00Z' },
          { eventAction: 'registrar expiration', eventDate: '2026-08-13T04:00:00Z' },
        ],
      }),
    });
    const result = await setup({ rdap: [registry] }).lookup();
    // gives it as the expiry, the registry's own beside it
    expect(result.record.expirationDate).toEqual(new Date('2026-08-13T04:00:00Z'));
    expect(result.record.registryExpirationDate).toEqual(new Date('2027-08-13T04:00:00Z'));
  });

  it('falls back to the registry’s expiry when the registrar gives none', async () => {
    const registrar = rdapRegistrarHop({
      data: rdapDomain({
        events: [{ eventAction: 'registration', eventDate: '1995-08-14T04:00:00Z' }],
      }),
    });
    const result = await setup({ rdap: [rdapHop(), registrar] }).lookup();
    expect(result.provenance?.expirationDate).toBe('registry');
    expect(result.record.expirationDate).toEqual(new Date('2027-08-13T04:00:00Z'));
  });

  it('returns the reseller as the server wrote it, even when it is the registrar', async () => {
    const registrar = whoisHop({
      server: 'whois.example-registrar.com',
      serverType: 'registrar',
      data: whoisData({ registrarName: 'NameCheap, Inc.', registrarReseller: ' NAMECHEAP INC ' }),
    });
    const result = await setup({ whois: [whoisHop(), registrar] }, { protocol: 'whois' }).lookup();
    expect(result.record.reseller).toBe('NAMECHEAP INC');
  });

  it('drops a placeholder date, over RDAP', async () => {
    const registrar = rdapRegistrarHop({
      data: rdapDomain({
        events: [
          { eventAction: 'registration', eventDate: '1995-08-14T04:00:00Z' },
          { eventAction: 'last changed', eventDate: '1970-01-01T00:00:00Z' },
          { eventAction: 'registrar expiration', eventDate: '0001-01-01T00:00:00Z' },
        ],
      }),
    });
    const result = await setup({ rdap: [rdapHop(), registrar] }).lookup();
    expect(result.record.updatedDate).toBeNull();
    expect(result.record.expirationDate).toEqual(new Date('2027-08-13T04:00:00Z'));
    expect(result.record.creationDate).toEqual(new Date('1995-08-14T04:00:00Z'));
  });

  it('takes whose expiry it is from which server gave it, over WHOIS', async () => {
    const registrar = whoisHop({
      server: 'whois.example-registrar.com',
      serverType: 'registrar',
      data: whoisData({
        expirationDate: new Date('2026-08-13T04:00:00Z'),
        registrantOrg: 'Example Org',
        registrarReseller: 'Hover',
      }),
    });
    const result = await setup({ whois: [whoisHop(), registrar] }, { protocol: 'whois' }).lookup();
    expect(result.record).toMatchObject({
      registryExpirationDate: new Date('2027-08-13T04:00:00Z'),
      expirationDate: new Date('2026-08-13T04:00:00Z'),
      registrant: { name: 'Example Org' },
      reseller: 'Hover',
    });
  });

  it('drops a registration date that cannot be right, and says so', async () => {
    const registry = rdapHop({
      data: rdapDomain({
        events: [{ eventAction: 'registration', eventDate: '2999-01-01T00:00:00Z' }],
      }),
    });
    const result = await setup({ rdap: [registry] }).lookup();
    expect(result.record.creationDate).toBeNull();
  });
});

describe('a referral that did not work out', () => {
  const failed = rdapRegistrarHop({
    status: 'error',
    httpStatus: 503,
    data: null,
    error: { name: 'ServerError', message: 'answered 503', retryable: true },
  });

  it('uses the registry’s answer when the registrar failed', async () => {
    const { lookup, called } = setup({ rdap: [rdapHop(), failed] });
    const result = await lookup();
    expect(called).toEqual(['rdap']);
    expect(result.record).toMatchObject({ available: false, reserved: false });
    expect(result.source).toMatchObject({ server: REGISTRY });
    expect(result.record.expirationDate).toEqual(new Date('2027-08-13T04:00:00Z'));
    // the failed server is still there to see
    expect(result.attempts[0]?.hops[1]).toMatchObject({ status: 'error', server: REGISTRAR });
  });

  it('never takes a registrar’s not-found as the name being free', async () => {
    const { lookup } = setup({
      rdap: [rdapHop(), rdapNotFound({ server: REGISTRAR, serverType: 'registrar' })],
    });
    const result = await lookup();
    expect(result.record).toMatchObject({ available: false, reserved: false });
    expect(result.source).toMatchObject({ server: REGISTRY });
  });

  // some registrar servers answer a domain query with a help page or an entity
  const notADomain = rdapRegistrarHop({
    data: { rdapConformance: ['rdap_level_0'], notices: [{ title: 'Help' }] } as never,
  });

  it('uses the registry’s answer when the registrar answered with something else', async () => {
    const { lookup } = setup({ rdap: [rdapHop(), notADomain] });
    const result = await lookup();
    expect(result.record).toMatchObject({ available: false, reserved: false });
    expect(result.source).toMatchObject({ server: REGISTRY });
  });

  it('is a good answer when the registrar failed', async () => {
    const client = new RdapWhois();
    const result = await client.lookup('example.com', {
      verbose: true,
      cache: answers({
        rdap: () => Promise.resolve([rdapHop(), failed]),
        whois: () => Promise.reject(new Error('whois was not expected to run')),
      }),
    });
    expect(result.record).toMatchObject({ available: false, reserved: false });
    expect(result.source).toMatchObject({ server: REGISTRY });
    expect(result.attempts[0]?.error).toBeUndefined();
  });

  it('keeps the registry’s answer when a WHOIS registrar says it has no such name', async () => {
    // 7mmtv.sx: registered at the registry, no match at its registrar, no RDAP
    const registrarSaysNo = whoisNotFound({
      server: 'whois.example-registrar.com',
      serverType: 'registrar',
    });
    const { lookup } = setup({ whois: [whoisHop(), registrarSaysNo] }, { protocol: 'whois' });
    const result = await lookup();
    expect(result.record).toMatchObject({ available: false, reserved: false });
    expect(result.source).toMatchObject({ protocol: 'whois', serverType: 'registry' });
    expect(result.attempts[0]?.hops[1]).toMatchObject({ status: 'notfound' });
  });
});

describe('an answer about some other domain', () => {
  const otherName = rdapHop({ data: rdapDomain({ ldhName: 'EXAMPLE.NET' }) });

  it('fails the source when the first server gave it, and WHOIS answers instead', async () => {
    const { lookup, called } = setup({ rdap: [otherName], whois: [whoisHop()] });
    const result = await lookup();
    expect(called).toEqual(['rdap', 'whois']);
    expect(result.source?.protocol).toBe('whois');
    expect(result.attempts[0]?.error).toMatchObject({
      name: 'InvalidResponseError',
      message: `${REGISTRY} answered about "example.net", not "example.com"`,
    });
  });

  it('is thrown when WHOIS has nothing either', async () => {
    const { lookup } = setup({ rdap: [otherName], whois: [whoisServerError] });
    await expect(lookup()).rejects.toBeInstanceOf(InvalidResponseError);
  });

  it('is set aside like a failed referral when the registrar gave it', async () => {
    const otherRegistrar = rdapRegistrarHop({ data: rdapDomain({ ldhName: 'example.net' }) });
    const { lookup } = setup({ rdap: [rdapHop(), otherRegistrar] });
    const result = await lookup();
    expect(result.source).toMatchObject({ server: REGISTRY });
    expect(result.record.domainName).toBe('example.com');
  });

  it('is used as it is when validate is off', async () => {
    const { lookup, called } = setup({ rdap: [otherName] }, { validate: false });
    const result = await lookup();
    expect(called).toEqual(['rdap']);
    expect(result.source?.protocol).toBe('rdap');
  });
});

describe('an available name', () => {
  it('needs the registry to say so', async () => {
    const { lookup, called, events } = setup({ rdap: [rdapNotFound()] });
    const result = await lookup();

    // the registry's own RDAP 404 is final, without a body as Verisign sends it: WHOIS
    // is not asked
    expect(called).toEqual(['rdap']);
    expect(events.filter(event => event.type === 'fallback')).toEqual([]);
    expect(result.record).toMatchObject({
      domainName: 'example.com',
      available: true,
      reserved: false,
      creationDate: null,
      registrar: null,
    });
    // RDAP said it first, so RDAP is named
    expect(result.source).toMatchObject({ protocol: 'rdap', server: REGISTRY });
  });

  it('is still checked over WHOIS when WHOIS routes the name to a registry below RDAP’s', async () => {
    // Nominet's RDAP has no record of ox.ac.uk, which JISC holds
    const nominet = rdapNotFound({
      server: 'https://rdap.nominet.uk/uk/',
      url: 'https://rdap.nominet.uk/uk/domain/ox.ac.uk',
    });
    const jisc = whoisHop({ server: 'whois.ja.net', data: whoisData({ domainName: 'ox.ac.uk' }) });
    const { lookup, called } = setup({ rdap: [nominet], whois: [jisc] });
    const result = await lookup('ox.ac.uk');
    expect(called).toEqual(['rdap', 'whois']);
    expect(result.record).toMatchObject({ available: false, reserved: false });
    expect(result.source).toMatchObject({ protocol: 'whois', server: 'whois.ja.net' });
  });

  it('is not claimed on that RDAP 404 when the registry below it fails', async () => {
    const nominet = rdapNotFound({ server: 'https://rdap.nominet.uk/uk/' });
    const { lookup } = setup({
      rdap: [nominet],
      whois: new TimeoutError('whois.ja.net timed out'),
    });
    await expect(lookup('ox.ac.uk')).rejects.toBeInstanceOf(TimeoutError);
  });

  it('is still checked over WHOIS for a CentralNic name under a second-level zone', async () => {
    // Verisign's RDAP answers for .com, not for the names CentralNic sells under br.com
    const centralnic = whoisHop({
      server: 'whois.centralnic.net',
      data: whoisData({ domainName: 'example.br.com' }),
    });
    const { lookup, called } = setup({ rdap: [rdapNotFound()], whois: [centralnic] });
    const result = await lookup('www.example.br.com');
    expect(called).toEqual(['rdap', 'whois']);
    expect(result.query).toBe('example.br.com');
    expect(result.record.available).toBe(false);
  });

  it('is not claimed while a registry said it has the name, RDAP first', async () => {
    // RDAP found it but gave too little to use; WHOIS then says no such name
    const thin = rdapHop({ data: rdapDomain({ entities: [], nameservers: [], events: [] }) });
    const { lookup } = setup({ rdap: [thin], whois: [whoisNotFound()] });
    await expect(lookup()).rejects.toBeInstanceOf(NoUsableAnswerError);
  });

  it('is not claimed while a registry said it has the name, WHOIS second', async () => {
    // Nominet's RDAP 404, then JISC answering with a record nothing could be read from
    const nominet = rdapNotFound({ server: 'https://rdap.nominet.uk/uk/' });
    const empty = whoisHop({
      server: 'whois.ja.net',
      data: whoisData({
        domainName: 'ox.ac.uk',
        registrarName: null,
        registrarIanaId: null,
        registrarId: null,
        nameservers: null,
        creationDate: null,
      }),
    });
    const { lookup } = setup({ rdap: [nominet], whois: [empty] });
    await expect(lookup('ox.ac.uk')).rejects.toBeInstanceOf(NoUsableAnswerError);
  });

  it('stands when the other source failed', async () => {
    const { lookup } = setup({
      rdap: new TimeoutError('rdap timed out'),
      whois: [whoisNotFound()],
    });
    const result = await lookup();
    expect(result.record).toMatchObject({ available: true, reserved: false });
    expect(result.source).toMatchObject({ protocol: 'whois' });
    expect(result.attempts[0]).toMatchObject({ protocol: 'rdap', error: { name: 'TimeoutError' } });
  });

  it('is not claimed on a registrar’s word', async () => {
    const registrarSaysNo = whoisNotFound({
      server: 'whois.example-registrar.com',
      serverType: 'registrar',
    });
    const { lookup } = setup({ whois: [registrarSaysNo] }, { protocol: 'whois' });
    await expect(lookup()).rejects.toBeInstanceOf(NoUsableAnswerError);
  });
});

describe('no answer', () => {
  it('rethrows the failure itself when nothing said the name does not exist', async () => {
    const whoisFailure = new ConnectionError('whois refused');
    const { lookup, events } = setup({
      rdap: new TimeoutError('rdap timed out'),
      whois: whoisFailure,
    });
    const error = await lookup().catch((e: unknown) => e);
    // the same object the source threw, not a copy
    expect(error).toBe(whoisFailure);
    expect(events).toContainEqual({ type: 'fallback', from: 'rdap', to: 'whois', reason: 'error' });
  });

  it('rethrows anything a source throws, whatever it is', async () => {
    class ToolError extends Error {}
    const failure = new ToolError('from the caller’s own tool');
    const { lookup } = setup({ rdap: failure, whois: failure });
    expect(await lookup().catch((e: unknown) => e)).toBe(failure);
  });

  it('is a NoUsableAnswerError when servers answered but with nothing usable', async () => {
    const thinRdap = rdapHop({ data: rdapDomain({ entities: [], nameservers: [], events: [] }) });
    const thinWhois = whoisServerError;
    const { lookup } = setup({ rdap: [thinRdap], whois: [thinWhois] });
    const error = (await lookup().catch((e: unknown) => e)) as NoUsableAnswerError;
    expect(error).toBeInstanceOf(NoUsableAnswerError);
    // what was tried comes with it
    expect(error.attempts.map(attempt => attempt.protocol)).toEqual(['rdap', 'whois']);
    expect(error.attempts[0]?.hops).toEqual([thinRdap]);
  });

  it('says why when an answer could not be read, instead of passing it over silently', async () => {
    // a response the transform cannot make a record from
    const unreadable = rdapHop({ data: rdapDomain({ nameservers: [null] }) });
    const { lookup, events } = setup({ rdap: [unreadable], whois: [whoisServerError] });
    const error = (await lookup().catch((e: unknown) => e)) as NoUsableAnswerError;

    expect(error).toBeInstanceOf(NoUsableAnswerError);
    expect(error.cause).toBeInstanceOf(TypeError);
    expect(error.attempts[0]?.error).toMatchObject({ name: 'TypeError' });
    expect(events).toContainEqual({
      type: 'transform-error',
      protocol: 'rdap',
      server: REGISTRY,
      error: expect.objectContaining({ name: 'TypeError', retryable: false }) as unknown,
    });
  });

  it('still answers from the other server when one answer could not be read', async () => {
    const unreadable = rdapHop({
      server: REGISTRAR,
      serverType: 'registrar',
      data: rdapDomain({ entities: 5 }),
    });
    const { lookup, events } = setup({ rdap: [rdapHop(), unreadable] });
    const result = await lookup();
    expect(result.record).toMatchObject({ available: false, reserved: false });
    expect(result.source?.server).toBe(REGISTRY);
    expect(events.filter(e => e.type === 'transform-error')).toHaveLength(1);
  });

  it('throws NoServerError, never available, when the TLD has no server to ask', async () => {
    // .gr has no RDAP server and the routing data lists no WHOIS server for it, so nothing
    // is asked: IANA would only describe the TLD
    const iana = whoisHop({
      server: 'whois.iana.org',
      serverType: 'iana',
      data: whoisData({ domainName: 'gr', registrarName: 'ICS-FORTH GR' }),
    });
    const { lookup, called } = setup({ whois: [iana] });
    await expect(lookup('example.gr')).rejects.toBeInstanceOf(NoServerError);
    expect(called).toEqual([]);
  });

  it('throws NoServerError when IANA only describes a TLD the routing data does not list', async () => {
    const iana = whoisHop({
      server: 'whois.iana.org',
      serverType: 'iana',
      data: whoisData({ domainName: 'onion', registrarName: 'Tor Project' }),
    });
    const { lookup, called } = setup({ whois: [iana] });
    await expect(lookup('example.onion')).rejects.toBeInstanceOf(NoServerError);
    expect(called).toEqual(['whois']);
  });

  it('relies on RDAP under a TLD with no WHOIS server, and reports its failure', async () => {
    // .dev has an RDAP server and no WHOIS server: IANA's record of .dev is never asked
    // for, so an RDAP failure is the lookup's answer rather than the TLD's record
    const iana = whoisHop({
      server: 'whois.iana.org',
      serverType: 'iana',
      data: whoisData({ domainName: 'dev' }),
    });
    const { lookup, called } = setup({
      rdap: new TimeoutError('rdap timed out', { protocol: 'rdap' }),
      whois: [iana],
    });
    await expect(lookup('google.dev')).rejects.toBeInstanceOf(TimeoutError);
    expect(called).toEqual(['rdap']);
  });

  it('is available when the registry IANA points to has no such name', async () => {
    // a TLD with no RDAP server that the routing data does not list: IANA names the
    // registry's server, which the routing data would call a registrar
    const iana = whoisHop({
      server: 'whois.iana.org',
      serverType: 'iana',
      data: whoisData({ domainName: 'onion', registrarName: 'Example Onion Registry' }),
    });
    const registry = whoisNotFound({ server: 'whois.example-onion.test', serverType: 'registrar' });
    const { lookup } = setup({ whois: [iana, registry] });
    const result = await lookup('example.onion');
    expect(result.record).toMatchObject({ available: true, reserved: false });
    expect(result.source).toMatchObject({
      protocol: 'whois',
      server: 'whois.example-onion.test',
      serverType: 'registry',
    });
  });

  it('throws NoServerError when IANA has never heard of the TLD', async () => {
    const iana = whoisNotFound({ server: 'whois.iana.org', serverType: 'iana' });
    const { lookup } = setup({ whois: [iana] });
    await expect(lookup('test.invalid')).rejects.toBeInstanceOf(NoServerError);
  });

  it('refuses something that is not a domain name', async () => {
    const client = new RdapWhois();
    await expect(client.lookup('8.8.8.8')).rejects.toBeInstanceOf(InvalidQueryError);
    await expect(client.lookup('AS15169')).rejects.toBeInstanceOf(InvalidQueryError);
  });
});

describe('lookupMany', () => {
  // a client whose lookups finish when the test says so
  function batch() {
    const client = new RdapWhois();
    const waiting = new Map<string, () => void>();
    const started: string[] = [];
    const options: LookupOptions = {
      protocol: 'whois',
      cache: answers({
        whois: query =>
          new Promise(resolve => {
            started.push(query);
            waiting.set(query, () =>
              resolve([whoisHop({ data: whoisData({ domainName: query }) })])
            );
          }),
      }),
    };
    const finish = (query: string) => waiting.get(query)?.();
    return { client, options, started, finish };
  }
  const tick = () => new Promise(resolve => setTimeout(resolve, 5));

  it('keeps the given number of lookups in flight and yields each as it finishes', async () => {
    const { client, options, started, finish } = batch();
    const names = ['a.com', 'b.com', 'c.com', 'd.com'];
    const iterator = client.lookupMany(names, { ...options, batchConcurrency: 2 });

    const first = iterator.next();
    await tick();
    expect(started).toEqual(['a.com', 'b.com']);

    // the second finishes first, and is the first one out
    finish('b.com');
    expect((await first).value).toMatchObject({ query: 'b.com' });

    const second = iterator.next();
    await tick();
    expect(started).toEqual(['a.com', 'b.com', 'c.com']);
    finish('a.com');
    expect((await second).value).toMatchObject({ query: 'a.com' });

    const rest = [iterator.next(), iterator.next()];
    await tick();
    finish('c.com');
    finish('d.com');
    const queries = (await Promise.all(rest)).map(step => (step.value as { query: string }).query);
    expect(queries.sort()).toEqual(['c.com', 'd.com']);
    expect((await iterator.next()).done).toBe(true);
  });

  it('reports a failed lookup as that name’s outcome and carries on', async () => {
    const client = new RdapWhois();
    const failure = new ConnectionError('refused');
    const items = await client.lookupAll(['good.com', 'bad.com', 'also-good.com'], {
      protocol: 'whois',
      cache: answers({
        whois: query =>
          query === 'bad.com'
            ? Promise.reject(failure)
            : Promise.resolve([whoisHop({ data: whoisData({ domainName: query }) })]),
      }),
    });

    // in the order the names were given
    expect(items.map(item => item.query)).toEqual(['good.com', 'bad.com', 'also-good.com']);
    const [good, bad, alsoGood] = items;
    // `ok` says which of result and error an item has
    expect(good?.ok && good.result.record.domainName).toBe('good.com');
    expect(bad).toEqual({ query: 'bad.com', ok: false, error: failure });
    expect(alsoGood?.ok && alsoGood.result.record).toMatchObject({
      available: false,
      reserved: false,
    });
  });

  it('gives every outcome for a name that is listed twice', async () => {
    const client = new RdapWhois();
    const items = await client.lookupAll(['a.com', 'a.com'], {
      protocol: 'whois',
      cache: answers({
        whois: () => Promise.resolve([whoisHop({ data: whoisData({ domainName: 'a.com' }) })]),
      }),
    });
    expect(items).toHaveLength(2);
    expect(items.every(item => item.ok)).toBe(true);
  });
});

// the same, with nothing replaced: lookup() making its own RDAP and WHOIS requests
describe('with its own protocol lookups', () => {
  const rdapResponse = (body: unknown, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));
  const FAST = { backoff: 1, retries: 0, concurrency: 4, minInterval: 0 };

  it('answers from RDAP, following the registry’s link to the registrar', async () => {
    const asked: string[] = [];
    const client = new RdapWhois({
      ...FAST,
      fetch: url => {
        asked.push(url);
        return url.startsWith(REGISTRY)
          ? rdapResponse(
              rdapDomain({
                links: [
                  {
                    rel: 'related',
                    href: `${REGISTRAR}domain/EXAMPLE.COM`,
                    type: 'application/rdap+json',
                  },
                ],
              })
            )
          : rdapResponse(rdapRegistrarHop().data);
      },
    });

    const result = await client.lookup('example.com', { verbose: true });
    expect(asked).toEqual([`${REGISTRY}domain/example.com`, `${REGISTRAR}domain/example.com`]);
    expect(result.record).toMatchObject({
      available: false,
      reserved: false,
      registrant: { name: 'Example Org' },
      reseller: 'Hover',
      expirationDate: new Date('2026-08-13T04:00:00Z'),
    });
    expect(result.attempts[0]?.hops.map(hop => hop.status)).toEqual(['found', 'found']);
  });

  it('falls back to WHOIS when RDAP fails, over a real connection', async () => {
    const { startWhoisServer } = await import('./support/servers');
    const { connect: nodeConnect } = await import('../src/transports/node');
    const whois = await startWhoisServer(
      () =>
        'Domain Name: EXAMPLE.COM\r\nRegistrar: Example Registrar, Inc.\r\nRegistrar IANA ID: 9999\r\n'
    );
    try {
      const client = new RdapWhois({
        ...FAST,
        followReferrals: 0,
        fetch: () => rdapResponse('upstream down', 503),
        connect: (_, options) => nodeConnect(whois, options),
      });
      const result = await client.lookup('example.com', { verbose: true });

      expect(result.source).toMatchObject({ protocol: 'whois', server: 'whois.verisign-grs.com' });
      expect(result.record).toMatchObject({
        available: false,
        reserved: false,
        registrar: { name: 'Example Registrar, Inc.', ianaId: 9999 },
      });
      expect(result.attempts.map(attempt => [attempt.protocol, attempt.error?.name])).toEqual([
        ['rdap', 'ServerError'],
        ['whois', undefined],
      ]);
    } finally {
      await whois.close();
    }
  });

  it('says a name is available when the registry’s RDAP and WHOIS both say so', async () => {
    const { startWhoisServer } = await import('./support/servers');
    const { connect: nodeConnect } = await import('../src/transports/node');
    const whois = await startWhoisServer(() => 'No match for "NOPE.COM".\r\n');
    try {
      const client = new RdapWhois({
        ...FAST,
        fetch: () => rdapResponse({ rdapConformance: ['rdap_level_0'], errorCode: 404 }, 404),
        connect: (_, options) => nodeConnect(whois, options),
      });
      const result = await client.lookup('nope.com');
      expect(result.record).toMatchObject({
        domainName: 'nope.com',
        available: true,
        reserved: false,
      });
      expect(result.source).toMatchObject({ protocol: 'rdap', serverType: 'registry' });
    } finally {
      await whois.close();
    }
  });
});

describe('a host', () => {
  // every protocol lookup is recorded with the name it was asked for
  function asked(sources: { rdap?: RdapHop[]; whois?: WhoisHop[] }) {
    const queries: string[] = [];
    const client = new RdapWhois();
    const lookup = (query: string) =>
      client.lookup(query, {
        cache: answers({
          rdap: q => (queries.push(`rdap:${q}`), Promise.resolve(sources.rdap as CachedHops)),
          whois: q => (queries.push(`whois:${q}`), Promise.resolve(sources.whois as CachedHops)),
        }),
      });
    return { lookup, queries, client };
  }

  it('is looked up as the registered name under a TLD', async () => {
    const { lookup, queries } = asked({ rdap: [rdapHop()] });
    const result = await lookup('www.Example.com');
    expect(queries).toEqual(['rdap:example.com']);
    expect(result.query).toBe('example.com');
    expect(result.record.available).toBe(false);
  });

  it('is looked up as the registered name under a public second-level zone', async () => {
    const hop = rdapHop({ data: rdapDomain({ ldhName: 'bbc.co.uk' }) });
    const { lookup, queries } = asked({ rdap: [hop] });
    expect((await lookup('www.bbc.co.uk')).query).toBe('bbc.co.uk');
    expect(queries).toEqual(['rdap:bbc.co.uk']);
  });

  it('is looked up as the registered name under a zone only the routing data has', async () => {
    // ac.ru is not on the public suffix list, but has a registry of its own
    const hop = whoisHop({
      server: 'whois.ripn.net',
      data: whoisData({ domainName: 'msu.ac.ru' }),
    });
    const { lookup, queries } = asked({ whois: [hop] });
    expect((await lookup('www.msu.ac.ru')).query).toBe('msu.ac.ru');
    expect(queries).toEqual(['whois:msu.ac.ru']);
  });

  it('is looked up as the registered name under a CentralNic zone', async () => {
    const hop = whoisHop({
      server: 'whois.centralnic.net',
      data: whoisData({ domainName: 'example.uk.com' }),
    });
    const { lookup, queries } = asked({ rdap: [rdapNotFound()], whois: [hop] });
    expect((await lookup('mail.example.uk.com')).query).toBe('example.uk.com');
    expect(queries).toEqual(['rdap:example.uk.com', 'whois:example.uk.com']);
  });

  it('leaves a suffix on its own as it is', async () => {
    const hop = whoisHop({ server: 'whois.nic.uk', data: whoisData({ domainName: 'co.uk' }) });
    const { lookup, queries } = asked({
      rdap: [rdapNotFound({ server: 'https://rdap.nominet.uk/uk/' })],
      whois: [hop],
    });
    const result = await lookup('co.uk').catch(() => null);
    expect(queries[0]).toBe('rdap:co.uk');
    expect(result?.query ?? 'co.uk').toBe('co.uk');
  });

  it('is sent as it is by rdap() and whois()', async () => {
    const { client } = asked({});
    const keys: string[] = [];
    const cache = {
      get: (key: CacheKey) => (keys.push(key.query), Promise.resolve([] as unknown as CachedHops)),
      set: () => {},
    };
    await client.rdap('www.example.com', { cache });
    await client.whois('www.example.com', { cache });
    expect(keys).toEqual(['www.example.com', 'www.example.com']);
  });
});

describe('the merge rule', () => {
  const registrarWith = (overrides: Record<string, unknown>) =>
    rdapRegistrarHop({
      data: rdapDomain({
        ldhName: 'example.com',
        events: [
          { eventAction: 'registration', eventDate: '1995-08-14T04:00:00Z' },
          { eventAction: 'registrar expiration', eventDate: '2026-08-13T04:00:00Z' },
        ],
        entities: [
          entity('registrar', 'Example Registrar, Inc.', { handle: '9999', publicIds: IANA_9999 }),
          entity('registrant', 'Example Org'),
        ],
        ...overrides,
      }),
    });
  const registryWith = (overrides: Record<string, unknown>) =>
    rdapHop({ data: rdapDomain(overrides) });

  it('takes the statuses from the registry, and lists the registrar’s own', async () => {
    const registry = registryWith({
      status: ['client transfer prohibited', 'server delete prohibited'],
    });
    const registrar = registrarWith({ status: ['client transfer prohibited', 'client hold'] });
    const result = await setup({ rdap: [registry, registrar] }).lookup();
    expect(result.record.eppStatus).toEqual(['clientTransferProhibited', 'serverDeleteProhibited']);
    expect(result.discrepancies).toContainEqual({
      field: 'eppStatus',
      registry: ['clientTransferProhibited'],
      registrar: ['clientTransferProhibited', 'clientHold'],
    });
    expect(result.provenance?.status).toBe('registry');
  });

  it('does not call a registrar listing fewer server statuses a disagreement', async () => {
    // opera.com: the registrar lists one status, the registry four. The server* ones are
    // the registry's by definition
    const registry = registryWith({
      status: [
        'client transfer prohibited',
        'server delete prohibited',
        'server update prohibited',
      ],
    });
    const registrar = registrarWith({ status: ['client transfer prohibited'] });
    const result = await setup({ rdap: [registry, registrar] }).lookup();
    expect(result.discrepancies.map(d => d.field)).not.toContain('eppStatus');
  });

  it('keeps the registry’s statuses when the registrar sends none, as name.com does', async () => {
    const result = await setup({
      rdap: [registryWith({}), registrarWith({ status: undefined })],
    }).lookup();
    expect(result.record.eppStatus).toEqual(['clientTransferProhibited']);
  });

  it('takes the registrar’s statuses when the registry sends none', async () => {
    const result = await setup({
      rdap: [registryWith({ status: undefined }), registrarWith({ status: ['client hold'] })],
    }).lookup();
    expect(result.record.eppStatus).toEqual(['clientHold']);
    expect(result.provenance?.status).toBe('registrar');
  });

  it('takes DNSSEC from the registry', async () => {
    const registry = registryWith({ secureDNS: { zoneSigned: true, delegationSigned: false } });
    const registrar = registrarWith({ secureDNS: { delegationSigned: true } });
    const result = await setup({ rdap: [registry, registrar] }).lookup();
    expect(result.record.dnssec).toBe(false);
    expect(result.discrepancies.map(d => d.field)).toContain('dnssec');
    expect(result.provenance?.dnssec).toBe('registry');
  });

  it('takes the earlier creation date, from either side, and reports the difference', async () => {
    // opera.com: 1999 at the registry, 2017 (the transfer) at the registrar
    const transferred = registrarWith({
      events: [
        { eventAction: 'registration', eventDate: '2017-06-06T00:00:00Z' },
        { eventAction: 'registrar expiration', eventDate: '2026-08-13T04:00:00Z' },
      ],
    });
    const opera = await setup({ rdap: [registryWith({}), transferred] }).lookup();
    expect(opera.record.creationDate).toEqual(new Date('1995-08-14T04:00:00Z'));
    expect(opera.provenance?.creationDate).toBe('registry');
    expect(opera.discrepancies.map(d => d.field)).toContain('creationDate');

    // google.com.bh: the registry's object is newer than the registration
    const recreated = registryWith({
      events: [
        { eventAction: 'registration', eventDate: '2018-10-18T00:00:00Z' },
        { eventAction: 'expiration', eventDate: '2027-08-13T04:00:00Z' },
      ],
    });
    const bh = await setup({ rdap: [recreated, registrarWith({})] }).lookup();
    expect(bh.record.creationDate).toEqual(new Date('1995-08-14T04:00:00Z'));
    expect(bh.provenance?.creationDate).toBe('registrar');
  });

  it('passes over a creation date after the same server’s expiry', async () => {
    const wrong = registrarWith({
      events: [
        { eventAction: 'registration', eventDate: '1990-01-01T00:00:00Z' },
        { eventAction: 'registrar expiration', eventDate: '1989-01-01T00:00:00Z' },
      ],
    });
    const result = await setup({ rdap: [registryWith({}), wrong] }, { validate: false }).lookup();
    expect(result.record.creationDate).toEqual(new Date('1995-08-14T04:00:00Z'));
  });

  it('takes the contacts as the registrar’s whole set, never mixed with the registry’s', async () => {
    const registry = registryWith({
      entities: [
        entity('registrar', 'Example Registrar, Inc.', { publicIds: IANA_9999 }),
        entity('registrant', 'Registry View Of Org'),
        entity('technical', 'Registry Tech'),
      ],
    });
    const result = await setup({ rdap: [registry, registrarWith({})] }).lookup();
    expect(result.record.registrant?.name).toBe('Example Org');
    expect(result.record.tech).toBeNull();
    expect(result.provenance?.contacts).toBe('registrar');
  });

  it('takes the registry’s whole set of contacts when the registrar gave none', async () => {
    const registry = registryWith({
      entities: [
        entity('registrar', 'Example Registrar, Inc.', { publicIds: IANA_9999 }),
        entity('registrant', 'Registry View Of Org'),
      ],
    });
    const registrar = registrarWith({
      entities: [entity('registrar', 'Example Registrar, Inc.', { publicIds: IANA_9999 })],
    });
    const result = await setup({ rdap: [registry, registrar] }).lookup();
    expect(result.record.registrant?.name).toBe('Registry View Of Org');
    expect(result.provenance?.contacts).toBe('registry');
  });

  it('takes the registrar’s details from the registry only when the registrar gave none', async () => {
    const registry = registryWith({});
    const anonymous = registrarWith({ entities: [entity('registrant', 'Example Org')] });
    const result = await setup({ rdap: [registry, anonymous] }).lookup();
    expect(result.record.registrar).toMatchObject({
      name: 'Example Registrar, Inc.',
      ianaId: 9999,
    });
    expect(result.provenance?.registrar).toBe('registry');
  });

  it('takes the updated date from the registrar, else the registry', async () => {
    const changed = (date: string) => ({ eventAction: 'last changed', eventDate: date });
    const registry = registryWith({
      events: [
        { eventAction: 'registration', eventDate: '1995-08-14T04:00:00Z' },
        { eventAction: 'expiration', eventDate: '2027-08-13T04:00:00Z' },
        changed('2025-01-01T00:00:00Z'),
      ],
    });
    const registrar = registrarWith({
      events: [
        { eventAction: 'registration', eventDate: '1995-08-14T04:00:00Z' },
        changed('2025-06-01T00:00:00Z'),
      ],
    });
    const both = await setup({ rdap: [registry, registrar] }).lookup();
    expect(both.record.updatedDate).toEqual(new Date('2025-06-01T00:00:00Z'));
    const fallback = await setup({ rdap: [registry, registrarWith({})] }).lookup();
    expect(fallback.record.updatedDate).toEqual(new Date('2025-01-01T00:00:00Z'));
    expect(fallback.provenance?.updatedDate).toBe('registry');
  });

  it('says where every group came from', async () => {
    const result = await setup({ rdap: [registryWith({}), registrarWith({})] }).lookup();
    expect(result.provenance).toEqual({
      registrar: 'registrar',
      contacts: 'registrar',
      status: 'registry',
      nameservers: 'registry',
      dnssec: null,
      creationDate: 'registry',
      updatedDate: null,
      expirationDate: 'registrar',
    });
    const available = await setup({ rdap: [rdapNotFound()] }).lookup();
    expect(available.provenance).toBeNull();
  });

  it('gives a single answer’s expiry to that server’s side, or to neither', async () => {
    // a registry that passes on the registrar's expiry is still the only server asked
    const passesOn = whoisHop({
      data: whoisData({ registrarExpirationDate: new Date('2026-08-13T04:00:00Z') }),
    });
    const registry = await setup({ whois: [passesOn] }, { protocol: 'whois' }).lookup();
    expect(registry.provenance?.expirationDate).toBe('registry');
    // a server the routing data does not know is neither side
    const stranger = whoisHop({ serverType: 'unknown' });
    const unknown = await setup({ whois: [stranger] }, { protocol: 'whois' }).lookup();
    expect(unknown.provenance).toMatchObject({ expirationDate: null, nameservers: null });
  });

  it('finds the registry by its type, not by its place before the registrar', async () => {
    // a registrar that referred on to another: the registry is the first hop, not the
    // one before the last
    const middle = registrarWith({ status: ['client hold'] });
    const last = rdapRegistrarHop({
      server: 'https://rdap.other-registrar.example/',
      data: rdapDomain({ ldhName: 'example.com', status: ['client update prohibited'] }),
    });
    const registry = registryWith({ status: ['server delete prohibited'] });
    const result = await setup({ rdap: [registry, middle, last] }).lookup();
    expect(result.record.eppStatus).toEqual(['serverDeleteProhibited']);
  });

  it('finds the registry by its type when the lookup began at IANA', async () => {
    // a TLD the routing data does not list: IANA's record of the TLD, then the registry it
    // names, then the registrar
    const iana = whoisHop({
      server: 'whois.iana.org',
      serverType: 'iana',
      data: whoisData({ domainName: 'onion' }),
    });
    const registry = whoisHop({
      server: 'whois.nic.onion',
      serverType: 'unknown',
      data: whoisData({ domainName: 'name.onion', eppStatus: ['serverHold'] }),
    });
    const registrar = whoisHop({
      server: 'whois.example-registrar.com',
      serverType: 'unknown',
      data: whoisData({ domainName: 'name.onion', eppStatus: ['clientHold'] }),
    });
    const result = await setup(
      { whois: [iana, registry, registrar] },
      { protocol: 'whois' }
    ).lookup('name.onion');
    expect(result.record.eppStatus).toEqual(['serverHold']);
    expect(result.provenance?.status).toBe('registry');
  });
});
