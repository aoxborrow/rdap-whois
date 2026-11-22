// memoryCache(): the in-memory HopCache, on its own and under a client.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryCache } from '../src/cache';
import { RdapWhois } from '../src/client';
import type { CacheKey, CachedHops } from '../src/core';
import type { RdapHop } from '../src/rdap/client';
import type { FetchLike } from '../src/rdap/request';

const key = (query: string, extra: Partial<CacheKey> = {}): CacheKey => ({
  protocol: 'rdap',
  server: 'https://rdap.verisign.com/com/v1/',
  query,
  queryType: 'domain',
  ...extra,
});

const hops = (query: string): RdapHop[] => [
  {
    server: 'https://rdap.verisign.com/com/v1/',
    serverType: 'registry',
    url: `https://rdap.verisign.com/com/v1/domain/${query}`,
    status: 'notfound',
    httpStatus: 404,
    data: null,
    tries: 1,
    elapsed: 3,
  },
];

describe('memoryCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('answers what was stored, under the same key only', async () => {
    const cache = memoryCache();
    await cache.set(key('example.com'), hops('example.com'), 1000);
    expect(await cache.get(key('example.com'))).toEqual(hops('example.com'));
    expect(await cache.get(key('example.net'))).toBeUndefined();
    expect(await cache.get(key('example.com', { protocol: 'whois' }))).toBeUndefined();
    expect(await cache.get(key('example.com', { encoding: 'latin1' }))).toBeUndefined();
  });

  it('keeps an entry for the lifetime it was stored with', async () => {
    const cache = memoryCache();
    await cache.set(key('example.com'), hops('example.com'), 1000);
    vi.advanceTimersByTime(999);
    expect(await cache.get(key('example.com'))).toBeDefined();
    vi.advanceTimersByTime(1);
    expect(await cache.get(key('example.com'))).toBeUndefined();

    // a lifetime of nothing stores nothing
    await cache.set(key('example.net'), hops('example.net'), 0);
    expect(await cache.get(key('example.net'))).toBeUndefined();
  });

  it('drops the entry used least recently once it holds `max`', async () => {
    const cache = memoryCache({ max: 2 });
    await cache.set(key('a.com'), hops('a.com'), 1000);
    await cache.set(key('b.com'), hops('b.com'), 1000);
    // a.com is used, so b.com is now the one used least recently
    await cache.get(key('a.com'));
    await cache.set(key('c.com'), hops('c.com'), 1000);
    expect(await cache.get(key('b.com'))).toBeUndefined();
    expect(await cache.get(key('a.com'))).toBeDefined();
    expect(await cache.get(key('c.com'))).toBeDefined();
  });

  it('gives a copy, so changing what it gave does not change what it keeps', async () => {
    const cache = memoryCache();
    const stored = hops('example.com');
    await cache.set(key('example.com'), stored, 1000);
    stored[0]!.status = 'found';
    const first = (await cache.get(key('example.com'))) as RdapHop[];
    first[0]!.status = 'error';
    expect(((await cache.get(key('example.com'))) as RdapHop[])[0]?.status).toBe('notfound');
  });

  it('keeps a WHOIS hop’s dates as dates', async () => {
    const cache = memoryCache();
    const created = new Date('1995-08-14T04:00:00Z');
    const whois = [{ data: { creationDate: created } }] as unknown as CachedHops;
    await cache.set(key('example.com', { protocol: 'whois' }), whois, 1000);
    const [hop] = (await cache.get(key('example.com', { protocol: 'whois' }))) as unknown as {
      data: { creationDate: Date };
    }[];
    expect(hop?.data.creationDate).toEqual(created);
  });

  it('refuses a size that could hold nothing', () => {
    expect(() => memoryCache({ max: 0 })).toThrow(RangeError);
  });
});

describe('memoryCache under a client', () => {
  it('answers a query asked again without a request', async () => {
    const asked: string[] = [];
    const fetch: FetchLike = url => {
      asked.push(url);
      return Promise.resolve(new Response('{}', { status: 404 }));
    };
    const client = new RdapWhois({ fetch, retries: 0, cache: memoryCache() });
    const first = await client.rdap('nope.com');
    const again = await client.rdap('NOPE.com');
    expect(again).toEqual(first);
    expect(asked).toHaveLength(1);
  });
});
