// lookup(), whois() and rdap() on the shared default client, the WHOIS parser on its own,
// and the cache every protocol lookup goes through.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { lookup, rdap, RdapWhois, whois } from '../src/client';
import type { CacheKey, CachedHops, HopCache } from '../src/core';
import { ConnectionError } from '../src/errors';
import type { Connect } from '../src/net/types';
import type { FetchLike } from '../src/rdap/request';
import { connect as nodeConnect } from '../src/transports/node';
import { parseWhois, whoisThrottleLine } from '../src/whois';
import { startWhoisServer, type TestServer } from './support/servers';

const servers: TestServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => server.close()));
});

const REGISTRY = 'https://rdap.verisign.com/com/v1/';
const WHOIS_REGISTRY = 'whois.verisign-grs.com';
const FAST = { backoff: 1, retries: 0, concurrency: 4, minInterval: 0 };

const DOMAIN = {
  rdapConformance: ['rdap_level_0'],
  objectClassName: 'domain',
  ldhName: 'EXAMPLE.COM',
  events: [{ eventAction: 'registration', eventDate: '1995-08-14T04:00:00Z' }],
};
const NOT_FOUND = { rdapConformance: ['rdap_level_0'], errorCode: 404, title: 'Not Found' };

const WHOIS_RECORD = [
  '   Domain Name: EXAMPLE.COM',
  '   Registry Domain ID: 2336799_DOMAIN_COM-VRSN',
  '   Creation Date: 1995-08-14T04:00:00Z',
  '   Registry Expiry Date: 2027-08-13T04:00:00Z',
  '   Registrar: Example Registrar, Inc.',
  '   Name Server: A.IANA-SERVERS.NET',
  '>>> Last update of whois database: 2026-11-09T12:00:00Z <<<',
  '',
].join('\r\n');
const THROTTLED = 'Your connection limit exceeded. Please slow down and try again later.\r\n';

// an RDAP fetch that answers every request with one body, and counts the requests
function rdapServer(body: unknown, status = 200) {
  const asked: string[] = [];
  const fetch: FetchLike = url => {
    asked.push(url);
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  };
  return { fetch, asked };
}

// a cache kept in a Map, recording what it was given
function mapCache() {
  const entries = new Map<string, CachedHops>();
  const sets: { key: CacheKey; ttl: number }[] = [];
  const id = (key: CacheKey) => `${key.protocol}|${key.server}|${key.queryType}|${key.query}`;
  const cache: HopCache = {
    get: key => entries.get(id(key)),
    set: (key, hops, ttl) => {
      sets.push({ key, ttl });
      entries.set(id(key), hops);
    },
  };
  return { cache, sets };
}

describe('lookup(), whois() and rdap()', () => {
  it('look a query up over RDAP, as the client does', async () => {
    const server = rdapServer(DOMAIN);
    const hops = await rdap('Example.COM', { fetch: server.fetch, retries: 0 });
    expect(hops).toHaveLength(1);
    expect(hops[0]).toMatchObject({ server: REGISTRY, serverType: 'registry', status: 'found' });
    expect(server.asked).toEqual([`${REGISTRY}domain/example.com`]);
  });

  it('look a query up over WHOIS, as the client does', async () => {
    const server = await startWhoisServer(() => WHOIS_RECORD);
    servers.push(server);
    const connect: Connect = (target, options) => nodeConnect(server, options);
    const hops = await whois('example.com', { connect, retries: 0 });
    expect(hops[0]).toMatchObject({ server: WHOIS_REGISTRY, status: 'found' });
    expect(hops[0]?.data).toMatchObject({ domainName: 'example.com' });
  });

  it('share one client across every call, made the first time one is called', async () => {
    const used: RdapWhois[] = [];
    const spies = (['lookup', 'whois', 'rdap'] as const).map(method =>
      vi.spyOn(RdapWhois.prototype, method).mockImplementation(function (this: RdapWhois) {
        used.push(this);
        return Promise.resolve([] as never);
      })
    );
    try {
      await lookup('example.com');
      await whois('example.com');
      await rdap('example.com');
      expect(used).toHaveLength(3);
      expect(new Set(used).size).toBe(1);
    } finally {
      spies.forEach(spy => spy.mockRestore());
    }
  });
});

describe('parseWhois', () => {
  it('parses a response that was fetched some other way', () => {
    const parsed = parseWhois(WHOIS_RECORD, 'WHOIS.Verisign-GRS.com');
    expect(parsed.status).toBe('found');
    expect(parsed.data).toMatchObject({
      domainName: 'example.com',
      creationDate: new Date('1995-08-14T04:00:00Z'),
      nameservers: ['a.iana-servers.net'],
    });
  });

  it('reports a rate-limit page as throttled, with no data, and says which line it was', () => {
    expect(parseWhois(THROTTLED, WHOIS_REGISTRY)).toEqual({ status: 'throttled', data: null });
    expect(whoisThrottleLine(THROTTLED, WHOIS_REGISTRY)).toMatch(/connection limit exceeded/);
    expect(whoisThrottleLine(WHOIS_RECORD, WHOIS_REGISTRY)).toBeNull();
  });
});

describe('the cache', () => {
  it('keeps an answer under the protocol, the first server and the query', async () => {
    const server = rdapServer(DOMAIN);
    const { cache, sets } = mapCache();
    const client = new RdapWhois({ ...FAST, fetch: server.fetch, cache });

    const first = await client.rdap('example.com');
    expect(sets).toEqual([
      {
        key: { protocol: 'rdap', server: REGISTRY, query: 'example.com', queryType: 'domain' },
        ttl: 3_600_000,
      },
    ]);

    // asked again, the answer comes from the cache and no request is made
    const again = await client.rdap('EXAMPLE.com');
    expect(again).toEqual(first);
    expect(server.asked).toHaveLength(1);
  });

  it('answers lookup() from the cache too', async () => {
    const server = rdapServer(DOMAIN);
    const { cache } = mapCache();
    const client = new RdapWhois({ ...FAST, fetch: server.fetch, cache, validate: false });
    await client.rdap('example.com');
    const result = await client.lookup('example.com');
    expect(result.record).toMatchObject({ available: false, reserved: false });
    expect(server.asked).toHaveLength(1);
  });

  it('keeps "no such object" for less time, and still throws it when asked to', async () => {
    const server = rdapServer(NOT_FOUND, 404);
    const { cache, sets } = mapCache();
    const client = new RdapWhois({ ...FAST, fetch: server.fetch, cache });
    const hops = await client.rdap('nope.com');
    expect(hops[0]?.status).toBe('notfound');
    expect(sets[0]?.ttl).toBe(300_000);

    // a cached negative is answered like a fresh one
    expect((await client.rdap('nope.com'))[0]?.status).toBe('notfound');
    expect(server.asked).toHaveLength(1);
  });

  it('caches nothing when the first server fails', async () => {
    const { cache, sets } = mapCache();
    const fetch: FetchLike = () => Promise.reject(new TypeError('fetch failed'));
    const client = new RdapWhois({ ...FAST, fetch, cache });
    await expect(client.rdap('example.com')).rejects.toBeInstanceOf(ConnectionError);
    expect(sets).toEqual([]);
  });

  it('gives up on a cache that does not answer when the call runs out of time', async () => {
    const stalled: HopCache = { get: () => new Promise(() => {}), set: () => {} };
    const fetch: FetchLike = () => Promise.reject(new TypeError('not reached'));
    const client = new RdapWhois({ ...FAST, fetch, cache: stalled, totalTimeout: 50 });
    const error = await client.rdap('example.com').catch((e: unknown) => e);
    expect((error as Error).name).toBe('TimeoutError');
    expect((error as Error).message).toMatch(/totalTimeout/);
  });

  it('keeps the answer when storing it outlasts the call', async () => {
    const server = rdapServer(DOMAIN);
    const slowStore: HopCache = { get: () => null, set: () => new Promise(() => {}) };
    const client = new RdapWhois({
      ...FAST,
      fetch: server.fetch,
      cache: slowStore,
      totalTimeout: 100,
    });
    const hops = await client.rdap('example.com');
    expect(hops[0]?.status).toBe('found');
  });

  it('does not ask the cache once the call is already aborted', async () => {
    let asked = 0;
    const counting: HopCache = {
      get: () => {
        asked++;
        return null;
      },
      set: () => {},
    };
    const client = new RdapWhois({ ...FAST, cache: counting });
    const controller = new AbortController();
    controller.abort(new Error('caller gave up'));
    await expect(client.rdap('example.com', { signal: controller.signal })).rejects.toThrow(
      'caller gave up'
    );
    expect(asked).toBe(0);
  });

  it('gives up on a cache that does not answer when the caller aborts', async () => {
    const stalled: HopCache = { get: () => new Promise(() => {}), set: () => {} };
    const fetch: FetchLike = () => Promise.reject(new TypeError('not reached'));
    const client = new RdapWhois({ ...FAST, fetch, cache: stalled, totalTimeout: Infinity });
    const controller = new AbortController();
    const pending = client.rdap('example.com', { signal: controller.signal });
    controller.abort(new Error('caller gave up'));
    await expect(pending).rejects.toThrow('caller gave up');
  });

  it('keys a WHOIS lookup by its server’s hostname', async () => {
    const whois = await startWhoisServer(() => WHOIS_RECORD);
    servers.push(whois);
    const connect: Connect = (target, options) => nodeConnect(whois, options);
    const { cache, sets } = mapCache();
    const client = new RdapWhois({ ...FAST, connect, cache });
    await client.whois('example.com');
    await client.whois('example.com');
    expect(sets.map(set => set.key)).toEqual([
      { protocol: 'whois', server: WHOIS_REGISTRY, query: 'example.com', queryType: 'domain' },
    ]);
    expect(whois.queries).toEqual(['example.com']);
  });

  it('fails the call with what the cache throws', async () => {
    const server = rdapServer(DOMAIN);
    const broken = new Error('cache is down');
    const client = new RdapWhois({
      ...FAST,
      fetch: server.fetch,
      cache: { get: () => Promise.reject(broken), set: () => {} },
    });
    await expect(client.rdap('example.com')).rejects.toBe(broken);
    expect(server.asked).toEqual([]);
  });
});
