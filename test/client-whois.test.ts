// client.whois() end to end against local servers: the referral loop, what happens when a
// hop fails, retries, throttling, the server asked for and proxy routing.
import { afterEach, describe, expect, it } from 'vitest';
import { RdapWhois } from '../src/client';
import type { ClientEvent } from '../src/core';
import {
  ConnectionError,
  EmptyResponseError,
  InvalidQueryError,
  NoServerError,
  RateLimitError,
  RdapWhoisError,
  ServerError,
  TimeoutError,
} from '../src/errors';
import type { Connect } from '../src/net/types';
import { connect as nodeConnect } from '../src/transports/node';
import {
  closedPort,
  startSocksProxy,
  startWhoisServer,
  type TestServer,
  type WhoisReply,
} from './support/servers';

const servers: TestServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => server.close()));
});

// real hostnames, so each hop gets the server type and the parser it would get in
// production. The connect below sends them to local test servers instead
const REGISTRY = 'whois.verisign-grs.com';
const REGISTRAR = 'whois.example-registrar.com';

const REGISTRY_RECORD = [
  '   Domain Name: EXAMPLE.COM',
  '   Registry Domain ID: 2336799_DOMAIN_COM-VRSN',
  `   Registrar WHOIS Server: ${REGISTRAR}`,
  '   Registrar URL: http://www.registrar.test',
  '   Updated Date: 2024-08-14T07:01:34Z',
  '   Creation Date: 1995-08-14T04:00:00Z',
  '   Registry Expiry Date: 2027-08-13T04:00:00Z',
  '   Registrar: Example Registrar, Inc.',
  '   Registrar IANA ID: 9999',
  '   Domain Status: clientTransferProhibited https://icann.org/epp#clientTransferProhibited',
  '   Name Server: A.IANA-SERVERS.NET',
  '   Name Server: B.IANA-SERVERS.NET',
  '   DNSSEC: signedDelegation',
  '>>> Last update of whois database: 2026-11-09T12:00:00Z <<<',
  '',
].join('\r\n');

const REGISTRAR_RECORD = [
  'Domain Name: example.com',
  'Registry Domain ID: 2336799_DOMAIN_COM-VRSN',
  `Registrar WHOIS Server: ${REGISTRAR}`,
  'Updated Date: 2024-08-14T07:01:34Z',
  'Creation Date: 1995-08-14T04:00:00Z',
  'Registrar Registration Expiration Date: 2026-08-13T04:00:00Z',
  'Registrar: Example Registrar, Inc.',
  'Registrar IANA ID: 9999',
  'Registrant Organization: Example Org',
  'Registrant Country: US',
  'Name Server: a.iana-servers.net',
  '',
].join('\r\n');

const NOT_FOUND = 'No match for "NOPE.COM".\r\n>>> Last update of whois database: 2026 <<<\r\n';
const THROTTLED = 'Your connection limit exceeded. Please slow down and try again later.\r\n';

// text as ISO-8859-1 bytes, one byte per character
const latin1 = (text: string): Uint8Array => Uint8Array.from(text, c => c.charCodeAt(0));

type Responder = (query: string) => WhoisReply | Promise<WhoisReply>;

// start a WHOIS server per hostname and a connect that routes those hostnames to them
async function network(responders: Record<string, Responder>) {
  const routes = new Map<string, { host: string; port: number }>();
  const started: Record<string, Awaited<ReturnType<typeof startWhoisServer>>> = {};
  for (const [host, respond] of Object.entries(responders)) {
    const server = await startWhoisServer(respond);
    servers.push(server);
    started[host] = server;
    routes.set(host, server);
  }
  const connect: Connect = (target, options) =>
    nodeConnect(routes.get(target.host) ?? target, options);
  return { connect, servers: started, routes };
}

// fast settings for tests: no spacing between requests, and a short retry delay
const FAST = { backoff: 1, concurrency: 4, minInterval: 0 };

describe('the referral loop', () => {
  it('asks the registry, then the registrar it refers to', async () => {
    const net = await network({
      [REGISTRY]: () => REGISTRY_RECORD,
      [REGISTRAR]: () => REGISTRAR_RECORD,
    });
    const events: ClientEvent[] = [];
    const client = new RdapWhois({
      ...FAST,
      connect: net.connect,
      onEvent: e => events.push(e),
    });

    const hops = await client.whois('Example.COM');

    expect(hops.map(hop => [hop.server, hop.serverType, hop.status])).toEqual([
      [REGISTRY, 'registry', 'found'],
      [REGISTRAR, 'unknown', 'found'],
    ]);
    // the query is lowercased, and each server gets the same line
    expect(net.servers[REGISTRY]?.queries).toEqual(['example.com']);
    expect(net.servers[REGISTRAR]?.queries).toEqual(['example.com']);

    const [registry, registrar] = hops;
    expect(registry?.data).toMatchObject({
      domainName: 'example.com',
      creationDate: new Date('1995-08-14T04:00:00Z'),
      expirationDate: new Date('2027-08-13T04:00:00Z'),
      registrarName: 'Example Registrar, Inc.',
      nameservers: ['a.iana-servers.net', 'b.iana-servers.net'],
    });
    expect(registrar?.data).toMatchObject({
      expirationDate: new Date('2026-08-13T04:00:00Z'),
      registrantOrg: 'Example Org',
    });
    expect(registry?.raw).toContain('Domain Name: EXAMPLE.COM');
    expect(registry?.tries).toBe(1);

    expect(events.map(e => e.type)).toEqual(['request', 'referral', 'request']);
    expect(events[1]).toEqual({
      type: 'referral',
      protocol: 'whois',
      from: REGISTRY,
      to: REGISTRAR,
    });
    expect(events[0]).toMatchObject({
      protocol: 'whois',
      server: REGISTRY,
      query: 'example.com',
      attempt: 1,
      proxied: false,
    });
    expect((events[0] as { bytes: number }).bytes).toBe(REGISTRY_RECORD.length);
  });

  it('stops at the registry when referrals are off', async () => {
    const net = await network({
      [REGISTRY]: () => REGISTRY_RECORD,
      [REGISTRAR]: () => REGISTRAR_RECORD,
    });
    const client = new RdapWhois({ ...FAST, connect: net.connect });
    const hops = await client.whois('example.com', { followReferrals: 0 });
    expect(hops).toHaveLength(1);
    expect(net.servers[REGISTRAR]?.queries).toEqual([]);
  });

  it('does not follow a server that refers to itself', async () => {
    const net = await network({ [REGISTRAR]: () => REGISTRAR_RECORD });
    const client = new RdapWhois({ ...FAST, connect: net.connect });
    const hops = await client.whois('example.com', { server: REGISTRAR, followReferrals: 5 });
    expect(hops).toHaveLength(1);
    expect(net.servers[REGISTRAR]?.queries).toHaveLength(1);
  });

  it('does not go round a referral loop', async () => {
    const other = 'whois.other-registrar.net';
    const net = await network({
      [REGISTRAR]: () => REGISTRAR_RECORD.replace(`Server: ${REGISTRAR}`, `Server: ${other}`),
      [other]: () => REGISTRAR_RECORD,
    });
    const client = new RdapWhois({ ...FAST, connect: net.connect });
    const hops = await client.whois('example.com', { server: REGISTRAR, followReferrals: 5 });
    // registrar, then the other server, which points back at the first
    expect(hops.map(hop => hop.server)).toEqual([REGISTRAR, other]);
  });

  it('does not treat the server named in a TLD record as a referral', async () => {
    const net = await network({
      'whois.iana.org': () => 'domain:       COM\r\nwhois:        whois.verisign-grs.com\r\n',
      [REGISTRY]: () => REGISTRY_RECORD,
    });
    const client = new RdapWhois({ ...FAST, connect: net.connect });
    const hops = await client.whois('com');
    expect(hops.map(hop => hop.server)).toEqual(['whois.iana.org']);
  });
});

describe('not found', () => {
  it('returns the hop with its raw response', async () => {
    const net = await network({ [REGISTRY]: () => NOT_FOUND });
    const client = new RdapWhois({ ...FAST, connect: net.connect });
    const hops = await client.whois('nope.com');

    expect(hops).toHaveLength(1);
    expect(hops[0]).toMatchObject({ server: REGISTRY, status: 'notfound' });
    expect(hops[0]?.raw).toContain('No match for "NOPE.COM"');
    expect(hops[0]?.error).toBeUndefined();
  });
});

describe('a referral that fails', () => {
  const refusing = async () => {
    const net = await network({ [REGISTRY]: () => REGISTRY_RECORD });
    // the registrar's hostname leads to a port nothing listens on
    net.routes.set(REGISTRAR, { host: '127.0.0.1', port: await closedPort() });
    return net;
  };

  it('keeps the registry’s answer and reports the failed server beside it', async () => {
    const net = await refusing();
    const client = new RdapWhois({ ...FAST, connect: net.connect, retries: 1 });
    const hops = await client.whois('example.com');

    expect(hops.map(hop => [hop.server, hop.status])).toEqual([
      [REGISTRY, 'found'],
      [REGISTRAR, 'error'],
    ]);
    expect(hops[1]).toMatchObject({
      serverType: 'unknown',
      raw: null,
      data: null,
      tries: 2,
      error: { name: 'ConnectionError', retryable: true },
    });
  });

  // a proxy that tunnels to the registry and reports the registrar unreachable
  const unreachableRegistrar = async () => {
    const registry = await startWhoisServer(() => REGISTRY_RECORD);
    const proxy = await startSocksProxy({
      resolve: () => ({ host: '127.0.0.1', port: registry.port }),
      reply: host => (host === REGISTRAR ? 0x04 : undefined),
    });
    servers.push(registry, proxy);
    return proxy;
  };

  it('does not retry a proxy that could not open its tunnel to the registrar', async () => {
    const proxy = await unreachableRegistrar();
    const client = new RdapWhois({
      ...FAST,
      retries: 2,
      proxy: { whois: `socks5://127.0.0.1:${proxy.port}` },
    });
    const hops = await client.whois('example.com');

    expect(hops.map(hop => [hop.server, hop.status])).toEqual([
      [REGISTRY, 'found'],
      [REGISTRAR, 'error'],
    ]);
    expect(hops[1]).toMatchObject({
      tries: 1,
      error: { name: 'ConnectionError', viaProxy: true },
    });
    expect(proxy.requests.map(request => request.host)).toEqual([REGISTRY, REGISTRAR]);
  });

  it('still retries a proxy that could not open its tunnel to the first server', async () => {
    const proxy = await unreachableRegistrar();
    const client = new RdapWhois({
      ...FAST,
      retries: 2,
      proxy: { whois: `socks5://127.0.0.1:${proxy.port}` },
    });
    const error = await client.whois('example.com', { server: REGISTRAR }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectionError);
    expect(error).toMatchObject({ viaProxy: true, tries: 3 });
  });

  it('still retries a proxy that could not open its tunnel to the server IANA refers to', async () => {
    const iana = await startWhoisServer(() => 'refer:        whois.arin.net\r\n');
    const proxy = await startSocksProxy({
      resolve: () => ({ host: '127.0.0.1', port: iana.port }),
      reply: host => (host === 'whois.arin.net' ? 0x04 : undefined),
    });
    servers.push(iana, proxy);
    const client = new RdapWhois({
      ...FAST,
      retries: 2,
      proxy: { whois: `socks5://127.0.0.1:${proxy.port}` },
    });
    const hops = await client.whois('8.8.8.8');
    expect(hops.map(hop => [hop.server, hop.status])).toEqual([
      ['whois.iana.org', 'found'],
      ['whois.arin.net', 'error'],
    ]);
    expect(hops[1]).toMatchObject({ tries: 3, error: { viaProxy: true } });
  });

  it('still retries a proxy that could not open its tunnel to the regional registry ARIN refers to', async () => {
    const arin = await startWhoisServer(() => 'ReferralServer: whois://whois.ripe.net\r\n');
    const proxy = await startSocksProxy({
      resolve: () => ({ host: '127.0.0.1', port: arin.port }),
      reply: host => (host === 'whois.ripe.net' ? 0x04 : undefined),
    });
    servers.push(arin, proxy);
    const client = new RdapWhois({
      ...FAST,
      retries: 2,
      proxy: { whois: `socks5://127.0.0.1:${proxy.port}` },
    });
    const hops = await client.whois('193.0.6.139', { server: 'whois.arin.net' });
    expect(hops.map(hop => [hop.server, hop.status])).toEqual([
      ['whois.arin.net', 'found'],
      ['whois.ripe.net', 'error'],
    ]);
    expect(hops[1]).toMatchObject({ tries: 3, error: { viaProxy: true } });
  });

  it('reports a registrar that answers with an error message as a failed hop', async () => {
    const net = await network({
      [REGISTRY]: () => REGISTRY_RECORD,
      [REGISTRAR]: () => 'TLD is not supported.\r\n',
    });
    const client = new RdapWhois({ ...FAST, connect: net.connect });
    const hops = await client.whois('example.com');
    expect(hops.map(hop => hop.status)).toEqual(['found', 'error']);
    expect(hops[1]).toMatchObject({ error: { name: 'ServerError' } });
  });

  it('reports a registrar’s not-found as that hop’s status, not as a failure', async () => {
    const net = await network({
      [REGISTRY]: () => REGISTRY_RECORD,
      [REGISTRAR]: () => 'No match for "EXAMPLE.COM".\r\n',
    });
    const client = new RdapWhois({ ...FAST, connect: net.connect });
    const hops = await client.whois('example.com');
    expect(hops.map(hop => hop.status)).toEqual(['found', 'notfound']);
  });

  it('reports a throttled registrar beside the registry’s answer, with the throttle page', async () => {
    const net = await network({
      [REGISTRY]: () => REGISTRY_RECORD,
      [REGISTRAR]: () => THROTTLED,
    });
    const client = new RdapWhois({ ...FAST, connect: net.connect, retries: 1 });
    const hops = await client.whois('example.com');
    expect(hops[1]).toMatchObject({
      status: 'error',
      tries: 2,
      error: { name: 'RateLimitError' },
    });
    expect(hops[1]?.raw).toContain('limit exceeded');
  });
});

describe('a TLD with no WHOIS server', () => {
  it('is a NoServerError, and IANA is not asked for the TLD’s own record', async () => {
    const net = await network({
      'whois.iana.org': () => 'domain:       DEV\r\ncreated:      2014-11-20\r\n',
    });
    const client = new RdapWhois({ ...FAST, connect: net.connect });
    const error = await client.whois('google.dev').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NoServerError);
    expect(error).toMatchObject({ protocol: 'whois', query: 'google.dev' });
    expect(net.servers['whois.iana.org']?.queries).toEqual([]);
  });

  it('still asks IANA about the TLD itself', async () => {
    const net = await network({
      'whois.iana.org': () => 'domain:       DEV\r\ncreated:      2014-11-20\r\n',
    });
    const client = new RdapWhois({ ...FAST, connect: net.connect });
    const hops = await client.whois('dev');
    expect(hops.map(hop => hop.server)).toEqual(['whois.iana.org']);
  });
});

describe('the first server failing', () => {
  it('is thrown, with where it happened', async () => {
    const net = await network({});
    net.routes.set(REGISTRY, { host: '127.0.0.1', port: await closedPort() });
    const client = new RdapWhois({ ...FAST, connect: net.connect, retries: 0 });
    const error = await client.whois('example.com').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectionError);
    expect(error).toMatchObject({
      protocol: 'whois',
      server: REGISTRY,
      query: 'example.com',
      tries: 1,
    });
  });

  it('times out', async () => {
    const net = await network({ [REGISTRY]: () => ({ hang: true }) });
    const client = new RdapWhois({ ...FAST, connect: net.connect, retries: 0 });
    await expect(client.whois('example.com', { timeout: 100 })).rejects.toBeInstanceOf(
      TimeoutError
    );
  });

  it('reports an empty response as an error', async () => {
    const net = await network({ [REGISTRY]: () => '\r\n\r\n' });
    const client = new RdapWhois({ ...FAST, connect: net.connect, retries: 1 });
    const error = await client.whois('example.com').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EmptyResponseError);
    expect(net.servers[REGISTRY]?.queries).toHaveLength(2);
  });

  it('returns a server’s own error message as a hop with status error', async () => {
    const net = await network({ [REGISTRAR]: () => 'TLD is not supported.\r\n' });
    const client = new RdapWhois({ ...FAST, connect: net.connect });
    const hops = await client.whois('example.com', { server: REGISTRAR });
    expect(hops).toHaveLength(1);
    expect(hops[0]).toMatchObject({
      status: 'error',
      raw: 'TLD is not supported.',
      error: { name: 'ServerError' },
    });
  });
});

describe('retries', () => {
  it('sends the request again after a failure that could be temporary', async () => {
    let calls = 0;
    const net = await network({
      [REGISTRY]: () => (++calls === 1 ? { text: 'Domain', reset: true } : REGISTRY_RECORD),
    });
    const events: ClientEvent[] = [];
    const client = new RdapWhois({
      ...FAST,
      connect: net.connect,
      followReferrals: 0,
      onEvent: e => events.push(e),
    });

    const hops = await client.whois('example.com');
    expect(hops[0]).toMatchObject({ status: 'found', tries: 2 });
    expect(events.map(e => e.type)).toEqual(['request', 'retry', 'request']);
    expect(events[0]).toMatchObject({ attempt: 1, error: { name: 'ConnectionError' } });
    expect(events[1]).toMatchObject({ attempt: 1, error: { name: 'ConnectionError' } });
    expect(events[2]).toMatchObject({ attempt: 2 });
    expect(events[2]).not.toHaveProperty('error');
  });

  it('does not retry when retries are off', async () => {
    const net = await network({ [REGISTRY]: () => ({ text: 'Domain', reset: true }) });
    const client = new RdapWhois({ ...FAST, connect: net.connect, retries: 0 });
    await expect(client.whois('example.com')).rejects.toBeInstanceOf(ConnectionError);
    expect(net.servers[REGISTRY]?.queries).toHaveLength(1);
  });

  it('retries a throttle page, and answers once the server does', async () => {
    let calls = 0;
    const net = await network({
      [REGISTRY]: () => (++calls < 3 ? THROTTLED : REGISTRY_RECORD),
    });
    const client = new RdapWhois({ ...FAST, connect: net.connect, followReferrals: 0 });
    const hops = await client.whois('example.com');
    expect(hops[0]).toMatchObject({ status: 'found', tries: 3 });
  });

  it('always throws a throttle on the first server, carrying the throttle page', async () => {
    const net = await network({ [REGISTRY]: () => THROTTLED });
    const client = new RdapWhois({ ...FAST, connect: net.connect, retries: 1 });
    const error = (await client.whois('example.com').catch((e: unknown) => e)) as RateLimitError;
    expect(error).toBeInstanceOf(RateLimitError);
    expect(error.raw).toContain('Your connection limit exceeded');
    expect(error.tries).toBe(2);
    expect(net.servers[REGISTRY]?.queries).toHaveLength(2);
  });

  it('holds back the next request to a server that has just throttled', async () => {
    const times: number[] = [];
    let calls = 0;
    const net = await network({
      [REGISTRY]: () => {
        times.push(Date.now());
        return ++calls === 1 ? THROTTLED : REGISTRY_RECORD;
      },
    });
    // one request at a time, no spacing: without a pause the second would go out the
    // moment the first gave up its place
    const client = new RdapWhois({
      connect: net.connect,
      retries: 1,
      backoff: 300,
      followReferrals: 0,
      concurrency: 1,
      minInterval: 0,
    });

    const first = client.whois('example.com');
    const second = client.whois('example.com');
    expect((await first)[0]?.status).toBe('found');
    expect((await second)[0]?.status).toBe('found');

    // the server's queue waited out the backoff (300 ms with jitter is at least 150 ms)
    // before anything else went out, the retry included
    expect(times).toHaveLength(3);
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(140);
  });

  it('waits out the delay before a retry', async () => {
    const times: number[] = [];
    let calls = 0;
    const net = await network({
      [REGISTRY]: () => {
        times.push(Date.now());
        return ++calls === 1 ? THROTTLED : REGISTRY_RECORD;
      },
    });
    const client = new RdapWhois({
      connect: net.connect,
      retries: 1,
      backoff: 300,
      followReferrals: 0,
    });

    expect((await client.whois('example.com'))[0]?.status).toBe('found');
    // the retry waited its own backoff (300 ms with jitter is at least 150 ms)
    expect(times).toHaveLength(2);
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(140);
  });

  it('leaves the queue alone when the throttled request will not be sent again', async () => {
    const times: number[] = [];
    let calls = 0;
    const net = await network({
      [REGISTRY]: () => {
        times.push(Date.now());
        return ++calls === 1 ? THROTTLED : REGISTRY_RECORD;
      },
    });
    const client = new RdapWhois({
      connect: net.connect,
      retries: 0,
      backoff: 300,
      followReferrals: 0,
      concurrency: 1,
      minInterval: 0,
    });

    const first = client.whois('example.com').catch((e: unknown) => e);
    const second = client.whois('example.com');
    expect(await first).toBeInstanceOf(RateLimitError);
    expect((await second)[0]?.status).toBe('found');

    // pausing would only have held back another caller's lookup
    expect(times).toHaveLength(2);
    expect(times[1]! - times[0]!).toBeLessThan(140);
  });

  it('drops a call still waiting for a place when its timeout runs out', async () => {
    let calls = 0;
    const net = await network({
      [REGISTRY]: () => {
        calls++;
        return { hang: true };
      },
    });
    const client = new RdapWhois({
      connect: net.connect,
      retries: 0,
      timeout: 200,
      followReferrals: 0,
      concurrency: 1,
      minInterval: 0,
    });

    // the first holds the only place until its own, longer timeout; the second waits for it
    // and times out at its own deadline, counted from the call, without being sent. With
    // equal deadlines the first could free its place just before the second gave up
    const first = client.whois('example.com', { timeout: 400 }).catch((e: unknown) => e);
    const started = Date.now();
    const second = await client.whois('example.com').catch((e: unknown) => e);
    expect(second).toBeInstanceOf(TimeoutError);
    expect(Date.now() - started).toBeLessThan(350);
    expect(await first).toBeInstanceOf(TimeoutError);
    expect(calls).toBe(1);
  });

  it('gives the connect and the exchange one timeout between them', async () => {
    const net = await network({ [REGISTRY]: () => ({ hang: true }) });
    // a connect that takes most of the timeout, then a server that never answers
    const slowConnect: Connect = async (target, options) => {
      await new Promise(resolve => setTimeout(resolve, 150));
      return net.connect(target, options);
    };
    const client = new RdapWhois({
      ...FAST,
      connect: slowConnect,
      retries: 0,
      timeout: 250,
      followReferrals: 0,
    });
    const started = Date.now();
    await expect(client.whois('example.com')).rejects.toBeInstanceOf(TimeoutError);
    expect(Date.now() - started).toBeLessThan(350);
  });

  it('fails at once when the wait for a retry would not fit in totalTimeout', async () => {
    let calls = 0;
    const net = await network({
      [REGISTRY]: () => {
        calls++;
        return THROTTLED;
      },
    });
    const client = new RdapWhois({
      connect: net.connect,
      retries: 3,
      backoff: 1000,
      totalTimeout: 200,
      followReferrals: 0,
    });
    const started = Date.now();
    const error = await client.whois('example.com').catch((e: unknown) => e);
    // the throttle behind the wait, sent once, without waiting
    expect(error).toBeInstanceOf(RateLimitError);
    expect(error).toMatchObject({ tries: 1 });
    expect(calls).toBe(1);
    // well short of the 1000 ms backoff, with room for loading the WHOIS side on first use
    expect(Date.now() - started).toBeLessThan(800);
  });

  it('fails a request queued behind a throttle pause that outlasts its time', async () => {
    let calls = 0;
    const net = await network({
      [REGISTRY]: () => (++calls === 1 ? THROTTLED : REGISTRY_RECORD),
    });
    const client = new RdapWhois({
      connect: net.connect,
      retries: 1,
      backoff: 600,
      followReferrals: 0,
      concurrency: 1,
      minInterval: 0,
    });

    // the first is throttled and will be retried after its backoff, which pauses the queue;
    // the second, waiting in that queue, has less time left than the pause
    const first = client.whois('example.com');
    const started = Date.now();
    const second = client.whois('example.com', { totalTimeout: 250 }).catch((e: unknown) => e);
    expect(await second).toBeInstanceOf(RateLimitError);
    expect(Date.now() - started).toBeLessThan(200);
    expect((await first)[0]?.status).toBe('found');
  });

  it('keeps the registry’s answer when the registrar runs out of the call’s time', async () => {
    const net = await network({
      [REGISTRY]: () => REGISTRY_RECORD,
      [REGISTRAR]: () => ({ hang: true }),
    });
    const client = new RdapWhois({ ...FAST, connect: net.connect, timeout: 5000 });
    const hops = await client.whois('example.com', { totalTimeout: 150 });
    expect(hops.map(hop => hop.status)).toEqual(['found', 'error']);
    expect(hops[1]?.error).toMatchObject({ name: 'TimeoutError' });
  });

  it('ends the whole call at totalTimeout', async () => {
    const net = await network({ [REGISTRY]: () => ({ hang: true }) });
    const client = new RdapWhois({
      ...FAST,
      connect: net.connect,
      timeout: 5000,
      retries: 3,
      totalTimeout: 100,
    });
    const started = Date.now();
    const error = await client.whois('example.com').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TimeoutError);
    expect((error as Error).message).toMatch(/totalTimeout/);
    expect(Date.now() - started).toBeLessThan(400);
  });

  it('stops retrying when the caller aborts', async () => {
    const net = await network({ [REGISTRY]: () => ({ hang: true }) });
    const controller = new AbortController();
    const client = new RdapWhois({ ...FAST, connect: net.connect, retries: 5 });
    const pending = client.whois('example.com', { signal: controller.signal });
    setTimeout(() => controller.abort(new Error('caller gave up')), 50);
    await expect(pending).rejects.toThrow('caller gave up');
    expect(net.servers[REGISTRY]?.queries).toHaveLength(1);
  });

  it('rejects with the signal’s own AbortError or TimeoutError', async () => {
    const net = await network({ [REGISTRY]: () => ({ hang: true }) });
    const client = new RdapWhois({ ...FAST, connect: net.connect, retries: 0 });

    const controller = new AbortController();
    const aborted = client.whois('example.com', { signal: controller.signal }).catch(e => e);
    setTimeout(() => controller.abort(), 20);
    const abort = (await aborted) as Error;
    expect(abort).toBeInstanceOf(DOMException);
    expect(abort.name).toBe('AbortError');
    expect(abort).not.toBeInstanceOf(RdapWhoisError);

    const timedOut = (await client
      .whois('example.com', { signal: AbortSignal.timeout(20) })
      .catch((e: unknown) => e)) as Error;
    expect(timedOut).toBeInstanceOf(DOMException);
    expect(timedOut.name).toBe('TimeoutError');
    expect(timedOut).not.toBeInstanceOf(RdapWhoisError);
  });
});

describe('the server asked for', () => {
  it('refuses a port that cannot be one', async () => {
    const client = new RdapWhois(FAST);
    await expect(
      client.whois('example.com', { server: 'whois.example.com', port: 70000 })
    ).rejects.toBeInstanceOf(RangeError);
  });

  it('connects to a local server, on the port asked for', async () => {
    const server = await startWhoisServer(() => REGISTRAR_RECORD);
    servers.push(server);
    const client = new RdapWhois(FAST);
    const hops = await client.whois('example.com', {
      server: '127.0.0.1',
      port: server.port,
      followReferrals: 0,
    });
    expect(hops[0]).toMatchObject({ server: '127.0.0.1', status: 'found' });
  });

  it('never contacts a referral that points at a local address', async () => {
    const contacted: string[] = [];
    const net = await network({
      [REGISTRY]: () => REGISTRY_RECORD.replace(REGISTRAR, 'localhost'),
    });
    const connect: Connect = (target, options) => {
      contacted.push(target.host);
      return net.connect(target, options);
    };
    const client = new RdapWhois({ ...FAST, connect });
    const hops = await client.whois('example.com');

    // the referral parser does not accept it as a server at all
    expect(contacted).toEqual([REGISTRY]);
    expect(hops.map(hop => hop.status)).toEqual(['found']);
  });
});

describe('proxy routing', () => {
  it('sends WHOIS through the proxy given for it, and RDAP only through its own', async () => {
    const whois = await startWhoisServer(() => REGISTRY_RECORD);
    const proxy = await startSocksProxy({
      resolve: () => ({ host: '127.0.0.1', port: whois.port }),
    });
    servers.push(whois, proxy);

    const events: ClientEvent[] = [];
    const client = new RdapWhois({
      ...FAST,
      followReferrals: 0,
      proxy: { whois: `socks5://127.0.0.1:${proxy.port}` },
      onEvent: e => events.push(e),
    });

    const hops = await client.whois('example.com');
    expect(hops[0]?.status).toBe('found');
    // the proxy was asked for the real server by name
    expect(proxy.requests).toEqual([{ host: REGISTRY, port: 43 }]);
    expect(events[0]).toMatchObject({ type: 'request', proxied: true });
  });

  // a slow server behind a slow proxy: each takes most of the timeout, together more
  async function slowProxiedClient(connectTimeout?: number) {
    const whois = await startWhoisServer(async () => {
      await new Promise(resolve => setTimeout(resolve, 150));
      return REGISTRY_RECORD;
    });
    const proxy = await startSocksProxy({
      resolve: () => ({ host: '127.0.0.1', port: whois.port }),
    });
    servers.push(whois, proxy);
    const slowConnect: Connect = async (target, options) => {
      await new Promise(resolve => setTimeout(resolve, 150));
      return nodeConnect(target, options);
    };
    const url = `socks5://127.0.0.1:${proxy.port}`;
    return new RdapWhois({
      ...FAST,
      connect: slowConnect,
      retries: 0,
      timeout: 250,
      followReferrals: 0,
      proxy: connectTimeout === undefined ? url : { url, connectTimeout },
    });
  }

  it('starts the hop timeout once the tunnel is up, when the proxy has a connectTimeout', async () => {
    const hops = await (await slowProxiedClient(1000)).whois('example.com');
    expect(hops[0]?.status).toBe('found');
  });

  it('keeps one deadline for the proxy leg too, when the proxy has no connectTimeout', async () => {
    await expect((await slowProxiedClient()).whois('example.com')).rejects.toBeInstanceOf(
      TimeoutError
    );
  });
});

describe('options', () => {
  it('lets one call override the client’s settings', async () => {
    const net = await network({ [REGISTRY]: () => ({ text: 'Domain', reset: true }) });
    const client = new RdapWhois({ ...FAST, connect: net.connect, retries: 3 });
    await expect(client.whois('example.com', { retries: 0 })).rejects.toBeInstanceOf(
      ConnectionError
    );
    expect(net.servers[REGISTRY]?.queries).toHaveLength(1);
  });

  it('is not broken by a listener that throws', async () => {
    const net = await network({ [REGISTRY]: () => REGISTRY_RECORD });
    const client = new RdapWhois({
      ...FAST,
      connect: net.connect,
      followReferrals: 0,
      onEvent: () => {
        throw new Error('listener bug');
      },
    });
    const hops = await client.whois('example.com');
    expect(hops[0]?.status).toBe('found');
  });

  it('asks a server in the form its config says it needs', async () => {
    const net = await network({
      'whois.denic.de': () => 'Domain: example.de\r\nStatus: connect\r\n',
    });
    const client = new RdapWhois({ ...FAST, connect: net.connect, followReferrals: 0 });
    await client.whois('example.de');
    expect(net.servers['whois.denic.de']?.queries).toEqual(['-T dn,ace example.de']);
  });

  it('reads a server in the encoding the routing data has for it', async () => {
    const net = await network({
      'whois.registro.br': () => latin1('domain:      nic.br\r\nowner:       Núcleo\r\n'),
    });
    const client = new RdapWhois({ ...FAST, connect: net.connect, followReferrals: 0 });
    const [hop] = await client.whois('nic.br');
    expect(hop?.raw).toContain('owner:       Núcleo');
  });

  it('applies the encoding option to the first server only', async () => {
    const registry = REGISTRY_RECORD.replace('Registrar: Example', 'Registrar: Examplé');
    const net = await network({
      [REGISTRY]: () => latin1(registry),
      [REGISTRAR]: () =>
        new TextEncoder().encode(REGISTRAR_RECORD.replace('Example Org', 'Exämple Org')),
    });
    const client = new RdapWhois({ ...FAST, connect: net.connect });
    const [first, second] = await client.whois('example.com', { encoding: 'iso-8859-1' });
    expect(first?.raw).toContain('Registrar: Examplé');
    // the registrar is read as UTF-8, its own encoding, not the one asked for the registry
    expect(second?.raw).toContain('Exämple Org');
  });

  it('reads a referral in its own server’s encoding', async () => {
    const referring = REGISTRY_RECORD.replace(REGISTRAR, 'whois.dinahosting.com');
    const net = await network({
      [REGISTRY]: () => referring,
      'whois.dinahosting.com': () => latin1(REGISTRAR_RECORD.replace('Example Org', 'Jorge Tomás')),
    });
    const client = new RdapWhois({ ...FAST, connect: net.connect });
    const [, registrar] = await client.whois('example.com', { encoding: 'utf-8' });
    expect(registrar?.server).toBe('whois.dinahosting.com');
    expect(registrar?.raw).toContain('Jorge Tomás');
  });

  it('works out what the query is, and routes it accordingly', async () => {
    const net = await network({ 'whois.iana.org': () => 'refer:        whois.arin.net\r\n' });
    const client = new RdapWhois({ ...FAST, connect: net.connect, followReferrals: 0 });
    const hops = await client.whois('8.8.8.8');
    // an IP address goes to IANA, not to a TLD's registry
    expect(hops[0]?.server).toBe('whois.iana.org');
    expect(net.servers['whois.iana.org']?.queries).toEqual(['8.8.8.8']);
  });
});
