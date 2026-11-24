// client.rdap() end to end against local HTTP servers: what each kind of response means,
// redirects, the referral loop, validation, retries and the three transports.
import type http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { RdapWhois } from '../src/client';
import type { ClientEvent } from '../src/core';
import {
  ConnectionError,
  EmptyResponseError,
  InvalidQueryError,
  InvalidResponseError,
  NoServerError,
  RateLimitError,
  ServerError,
  TimeoutError,
} from '../src/errors';
import type { FetchLike } from '../src/rdap/request';
import {
  closedPort,
  startHttpServer,
  startSocksProxy,
  type HttpTestServer,
  type TestServer,
} from './support/servers';

const servers: TestServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => server.close()));
});

// real server URLs, so each hop gets the server type it would get in production. The
// routing fetch below sends them to local test servers
const REGISTRY = 'https://rdap.verisign.com/com/v1/';
const REGISTRAR = 'https://rdap.example-registrar.com/rdap/';

const domain = (overrides: Record<string, unknown> = {}) => ({
  rdapConformance: ['rdap_level_0'],
  objectClassName: 'domain',
  handle: '2336799_DOMAIN_COM-VRSN',
  ldhName: 'EXAMPLE.COM',
  status: ['client transfer prohibited'],
  events: [
    { eventAction: 'registration', eventDate: '1995-08-14T04:00:00Z' },
    { eventAction: 'expiration', eventDate: '2027-08-13T04:00:00Z' },
  ],
  ...overrides,
});
const withReferral = (href = `${REGISTRAR}domain/EXAMPLE.COM`) =>
  domain({
    links: [
      { rel: 'self', href: `${REGISTRY}domain/EXAMPLE.COM`, type: 'application/rdap+json' },
      { rel: 'related', href, type: 'application/rdap+json' },
    ],
  });
const NOT_FOUND = { rdapConformance: ['rdap_level_0'], errorCode: 404, title: 'Not Found' };

type Handler = (request: http.IncomingMessage, response: http.ServerResponse) => void;
const json =
  (body: unknown, status = 200, headers: Record<string, string> = {}): Handler =>
  (_, response) => {
    response.writeHead(status, { 'Content-Type': 'application/rdap+json', ...headers });
    response.end(typeof body === 'string' ? body : JSON.stringify(body));
  };

async function server(handler: Handler): Promise<HttpTestServer> {
  const started = await startHttpServer(handler);
  servers.push(started);
  return started;
}

// a fetch that sends each hostname to its local server, keeping the path
function routing(routes: Record<string, HttpTestServer | number>): FetchLike {
  return (url, init) => {
    const target = new URL(url);
    const route = routes[target.hostname];
    if (route === undefined) throw new TypeError(`no route for ${target.hostname}`);
    const port = typeof route === 'number' ? route : route.port;
    return fetch(`http://127.0.0.1:${port}${target.pathname}${target.search}`, init);
  };
}

// fast settings for tests: no spacing between requests, and a short retry delay
const FAST = { backoff: 1, concurrency: 4, minInterval: 0 };

describe('the referral loop', () => {
  it('asks the registry, then the registrar it links to', async () => {
    const registry = await server(json(withReferral()));
    const registrar = await server(json(domain({ ldhName: 'example.com' })));
    const events: ClientEvent[] = [];
    const client = new RdapWhois({
      ...FAST,
      userAgent: 'test-agent/1.0',
      fetch: routing({
        'rdap.verisign.com': registry,
        'rdap.example-registrar.com': registrar,
      }),
      onEvent: e => events.push(e),
    });

    const hops = await client.rdap('Example.COM');

    expect(hops.map(hop => [hop.server, hop.serverType, hop.status, hop.httpStatus])).toEqual([
      [REGISTRY, 'registry', 'found', 200],
      [REGISTRAR, 'unknown', 'found', 200],
    ]);
    expect(hops[0]?.url).toBe(`${REGISTRY}domain/example.com`);
    expect(hops[1]?.url).toBe(`${REGISTRAR}domain/example.com`);
    expect(hops[0]?.data).toMatchObject({ objectClassName: 'domain', ldhName: 'EXAMPLE.COM' });
    expect(hops[0]?.tries).toBe(1);

    expect(registry.requests[0]).toMatchObject({
      method: 'GET',
      url: '/com/v1/domain/example.com',
    });
    expect(registry.requests[0]?.headers.accept).toBe('application/json,application/rdap+json');
    expect(registry.requests[0]?.headers['user-agent']).toBe('test-agent/1.0');
    expect(registrar.requests[0]?.url).toBe('/rdap/domain/example.com');

    expect(events.map(e => e.type)).toEqual(['request', 'referral', 'request']);
    expect(events[0]).toMatchObject({
      protocol: 'rdap',
      server: REGISTRY,
      query: `${REGISTRY}domain/example.com`,
      attempt: 1,
      status: 200,
      proxied: false,
    });
    expect(events[1]).toEqual({
      type: 'referral',
      protocol: 'rdap',
      from: REGISTRY,
      to: REGISTRAR,
    });
  });

  it('stops at the registry when referrals are off', async () => {
    const registry = await server(json(withReferral()));
    const client = new RdapWhois({
      ...FAST,
      fetch: routing({ 'rdap.verisign.com': registry }),
    });
    const hops = await client.rdap('example.com', { followReferrals: 0 });
    expect(hops).toHaveLength(1);
  });

  it('does not follow a related link that is not an RDAP server', async () => {
    const registry = await server(
      json(
        domain({
          links: [
            { rel: 'related', href: 'https://www.example-registrar.com/', type: 'text/html' },
          ],
        })
      )
    );
    const client = new RdapWhois({
      ...FAST,
      fetch: routing({ 'rdap.verisign.com': registry }),
    });
    expect(await client.rdap('example.com')).toHaveLength(1);
  });

  it('does not follow a link back to the server that answered', async () => {
    const registry = await server(json(withReferral(`${REGISTRY}domain/EXAMPLE.COM`)));
    const client = new RdapWhois({
      ...FAST,
      fetch: routing({ 'rdap.verisign.com': registry }),
    });
    expect(await client.rdap('example.com')).toHaveLength(1);
    expect(registry.requests).toHaveLength(1);
  });

  it('follows a referral from a server the caller named, or one the data does not know', async () => {
    const registrar = await server(
      json(
        domain({
          links: [
            {
              rel: 'related',
              href: 'https://rdap.other-registrar.net/domain/example.com',
              type: 'application/rdap+json',
            },
          ],
        })
      )
    );
    const other = await server(json(domain()));
    const client = new RdapWhois({
      ...FAST,
      fetch: routing({
        'rdap.example-registrar.com': registrar,
        'rdap.other-registrar.net': other,
      }),
    });
    // a host the data does not know is 'unknown': it may refer, but is not authoritative
    const hops = await client.rdap('example.com', { server: REGISTRAR, followReferrals: 5 });
    expect(hops.map(hop => hop.serverType)).toEqual(['unknown', 'unknown']);
    expect(hops.map(hop => hop.status)).toEqual(['found', 'found']);
    // followReferrals still bounds it
    const one = await client.rdap('example.com', { server: REGISTRAR, followReferrals: 0 });
    expect(one).toHaveLength(1);
  });

  it('upgrades a plain-HTTP referral link to HTTPS', async () => {
    const registry = await server(
      json(withReferral('http://rdap.example-registrar.com/rdap/domain/EXAMPLE.COM'))
    );
    const registrar = await server(json(domain()));
    const asked: string[] = [];
    const route = routing({
      'rdap.verisign.com': registry,
      'rdap.example-registrar.com': registrar,
    });
    const client = new RdapWhois({
      ...FAST,
      fetch: (url, init) => {
        asked.push(url);
        return route(url, init);
      },
    });
    await client.rdap('example.com');
    expect(asked[1]).toBe(`${REGISTRAR}domain/example.com`);
  });

  it('reports a referral link that is not an HTTP URL as a failed hop', async () => {
    const registry = await server(json(withReferral('ftp://rdap.example-registrar.com/rdap/')));
    const asked: string[] = [];
    const route = routing({ 'rdap.verisign.com': registry });
    const client = new RdapWhois({
      ...FAST,
      fetch: (url, init) => {
        asked.push(url);
        return route(url, init);
      },
    });
    const hops = await client.rdap('example.com');
    expect(asked).toHaveLength(1);
    expect(hops[1]).toMatchObject({ status: 'error', error: { name: 'InvalidResponseError' } });
  });
});

describe('a redirect the runtime follows itself (a browser)', () => {
  // a fetch that behaves like a browser: a manual redirect comes back opaque, and a
  // followed one ends at `landing`
  const browserFetch =
    (landing: string, answer: unknown, asked: string[]): FetchLike =>
    (url, init) => {
      asked.push(`${init.redirect} ${url}`);
      if (init.redirect === 'manual') {
        return Promise.resolve(
          Object.defineProperty(new Response(null, { status: 200 }), 'type', {
            value: 'opaqueredirect',
          })
        );
      }
      const response = new Response(JSON.stringify(answer), {
        status: 200,
        headers: { 'Content-Type': 'application/rdap+json' },
      });
      return Promise.resolve(Object.defineProperty(response, 'url', { value: landing }));
    };

  it('does not follow it when redirects are off', async () => {
    const asked: string[] = [];
    const client = new RdapWhois({
      ...FAST,
      followRedirects: 0,
      fetch: browserFetch(`${REGISTRY}domain/example.com`, domain(), asked),
    });
    const error = await client.rdap('example.com').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServerError);
    expect(asked.every(line => line.startsWith('manual '))).toBe(true);
  });

  it('uses the answer wherever the redirect ended, a local address included', async () => {
    const client = new RdapWhois({
      ...FAST,
      fetch: browserFetch('http://127.0.0.1/domain/example.com', domain(), []),
    });
    const hops = await client.rdap('example.com');
    expect(hops[0]).toMatchObject({ status: 'found' });
  });
});

describe('a referral that fails', () => {
  const failing = async (handler: Handler) => {
    const registry = await server(json(withReferral()));
    const registrar = await server(handler);
    return routing({ 'rdap.verisign.com': registry, 'rdap.example-registrar.com': registrar });
  };

  it('keeps the registry’s answer and reports the failed server beside it', async () => {
    const client = new RdapWhois({
      ...FAST,
      retries: 1,
      fetch: await failing(json('upstream down', 503)),
    });
    const hops = await client.rdap('example.com');
    expect(hops.map(hop => hop.status)).toEqual(['found', 'error']);
    expect(hops[1]).toMatchObject({
      server: REGISTRAR,
      serverType: 'unknown',
      httpStatus: 503,
      data: null,
      tries: 2,
      error: { name: 'ServerError', retryable: true },
    });
  });

  it('does not retry a proxy that could not open its tunnel to the registrar', async () => {
    const registry = await server(json(withReferral()));
    const toRegistry = routing({ 'rdap.verisign.com': registry });
    const asked: string[] = [];
    const client = new RdapWhois({
      ...FAST,
      retries: 2,
      fetch: (url, init) => {
        const host = new URL(url).hostname;
        asked.push(host);
        if (host === 'rdap.example-registrar.com') {
          throw new ConnectionError('Could not connect: host unreachable', { viaProxy: true });
        }
        return toRegistry(url, init);
      },
    });
    const hops = await client.rdap('example.com');
    expect(hops.map(hop => hop.status)).toEqual(['found', 'error']);
    expect(hops[1]).toMatchObject({ tries: 1, error: { name: 'ConnectionError', viaProxy: true } });
    expect(asked).toEqual(['rdap.verisign.com', 'rdap.example-registrar.com']);
  });

  it('keeps the RDAP error body a failed registrar sent', async () => {
    const outage = { rdapConformance: ['rdap_level_0'], errorCode: 503, title: 'Down' };
    const client = new RdapWhois({ ...FAST, retries: 0, fetch: await failing(json(outage, 503)) });
    const hops = await client.rdap('example.com');
    expect(hops[1]).toMatchObject({ status: 'error', httpStatus: 503, data: outage });

    const throttle = { rdapConformance: ['rdap_level_0'], errorCode: 429, title: 'Slow down' };
    const throttled = new RdapWhois({
      ...FAST,
      retries: 0,
      fetch: await failing(json(throttle, 429)),
    });
    const [, registrar] = await throttled.rdap('example.com');
    expect(registrar).toMatchObject({ status: 'error', httpStatus: 429, data: throttle });
  });

  it('reports a registrar that refuses with an RDAP error as a failed hop', async () => {
    const refusal = { rdapConformance: ['rdap_level_0'], errorCode: 403, title: 'Forbidden' };
    const client = new RdapWhois({ ...FAST, fetch: await failing(json(refusal, 403)) });
    const hops = await client.rdap('example.com');
    expect(hops.map(hop => hop.status)).toEqual(['found', 'error']);
    expect(hops[1]).toMatchObject({ httpStatus: 403, data: refusal });
  });

  it('reports a registrar’s 404 as that hop’s status, not as a failure', async () => {
    const client = new RdapWhois({ ...FAST, fetch: await failing(json(NOT_FOUND, 404)) });
    const hops = await client.rdap('example.com');
    expect(hops.map(hop => hop.status)).toEqual(['found', 'notfound']);
  });

  it('reports a throttled registrar beside the registry’s answer', async () => {
    const client = new RdapWhois({
      ...FAST,
      retries: 1,
      fetch: await failing(json('slow down', 429)),
    });
    const hops = await client.rdap('example.com');
    expect(hops[1]).toMatchObject({
      status: 'error',
      tries: 2,
      error: { name: 'RateLimitError' },
    });
  });
});

describe('what a response means', () => {
  const ask = async (handler: Handler, options: Record<string, unknown> = {}) => {
    const local = await server(handler);
    const client = new RdapWhois({ ...FAST, retries: 0 });
    const result = await client
      .rdap('example.com', { server: `http://127.0.0.1:${local.port}/`, ...options })
      .catch((e: unknown) => e);
    return { result, local };
  };

  it('reads an errorCode sent as a string', async () => {
    const notFound = await ask(json({ ...NOT_FOUND, errorCode: '404' }, 404));
    expect((notFound.result as unknown[])[0]).toMatchObject({ status: 'notfound' });
    const throttled = await ask(json({ ...NOT_FOUND, errorCode: '429', title: 'Slow down' }));
    expect(throttled.result).toBeInstanceOf(RateLimitError);
  });

  it('a 404 with an RDAP error body is not-found, with the body', async () => {
    const { result } = await ask(json(NOT_FOUND, 404));
    expect(result).toHaveLength(1);
    expect((result as unknown[])[0]).toMatchObject({
      status: 'notfound',
      httpStatus: 404,
      data: { errorCode: 404, title: 'Not Found' },
    });
  });

  it('a 404 with no body is not-found', async () => {
    const { result } = await ask(json('', 404));
    expect((result as unknown[])[0]).toMatchObject({ status: 'notfound', data: null });
  });

  it('a 404 with an HTML page is not-found', async () => {
    const { result } = await ask(json('<html>Not Found</html>', 404));
    expect((result as unknown[])[0]).toMatchObject({ status: 'notfound', data: null });
  });

  it('a refusal with an RDAP error body is a hop with status error', async () => {
    const body = { rdapConformance: ['rdap_level_0'], errorCode: 403, title: 'Forbidden' };
    const { result } = await ask(json(body, 403));
    expect((result as unknown[])[0]).toMatchObject({
      status: 'error',
      httpStatus: 403,
      data: { errorCode: 403 },
      error: { name: 'ServerError', retryable: false },
    });
  });

  it('a server failure is thrown, with the status it answered', async () => {
    const { result } = await ask(json('oops', 500));
    expect(result).toBeInstanceOf(ServerError);
    expect(result).toMatchObject({ status: 500, retryable: true, tries: 1 });
  });

  it('a 200 that is not JSON is an invalid response', async () => {
    const { result, local } = await ask(json('<html>welcome</html>'));
    expect(result).toBeInstanceOf(InvalidResponseError);
    expect(result).toMatchObject({ status: 200 });
    expect(local.requests).toHaveLength(1);
  });

  it('a 200 that is JSON but not RDAP is an invalid response', async () => {
    const { result } = await ask(json({ hello: 'world' }));
    expect(result).toBeInstanceOf(InvalidResponseError);
  });

  it('a 200 with no body is an empty response', async () => {
    const { result } = await ask(json(''));
    expect(result).toBeInstanceOf(EmptyResponseError);
  });

  it('a body over the size cap is refused', async () => {
    const { result } = await ask(json(domain({ padding: 'x'.repeat(200_000) })), {
      maxResponseBytes: 10_000,
    });
    expect(result).toBeInstanceOf(InvalidResponseError);
    expect((result as Error).message).toMatch(/larger than 10000 bytes/);
  });

  it('a server that never answers times out', async () => {
    const { result } = await ask(() => {}, { timeout: 100 });
    expect(result).toBeInstanceOf(TimeoutError);
  });

  it('a refused connection is a ConnectionError', async () => {
    const client = new RdapWhois({ ...FAST, retries: 0 });
    const error = await client
      .rdap('example.com', { server: `http://127.0.0.1:${await closedPort()}/` })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectionError);
    expect(error).toMatchObject({ protocol: 'rdap' });
  });
});

describe('retries and throttling', () => {
  it('does not ask a server that timed out again', async () => {
    const local = await server(() => {});
    const client = new RdapWhois({ ...FAST, timeout: 100, retries: 2 });
    const error = await client
      .rdap('example.com', { server: `http://127.0.0.1:${local.port}/` })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TimeoutError);
    expect(error).toMatchObject({ retryable: false, tries: 1 });
    expect(local.requests).toHaveLength(1);
  });

  it('calls a wait for a free connection retryable, unlike a silent server', async () => {
    const local = await server(() => {});
    const client = new RdapWhois({ ...FAST, retries: 0, concurrency: 1 });
    // the first holds the only connection well past the second's time
    const ask = (timeout: number) =>
      client
        .rdap('example.com', { server: `http://127.0.0.1:${local.port}/`, timeout })
        .catch((e: unknown) => e);
    const [first, second] = await Promise.all([ask(600), ask(100)]);
    expect(first).toMatchObject({ name: 'TimeoutError', retryable: false });
    expect(second).toMatchObject({ name: 'TimeoutError', retryable: true });
    expect((second as Error).message).toMatch(/no free connection/);
  });

  it('retries a server failure and answers once the server does', async () => {
    let calls = 0;
    const local = await server((request, response) =>
      ++calls === 1 ? json('oops', 502)(request, response) : json(domain())(request, response)
    );
    const events: ClientEvent[] = [];
    const client = new RdapWhois({ ...FAST, onEvent: e => events.push(e) });
    const hops = await client.rdap('example.com', { server: `http://127.0.0.1:${local.port}/` });
    expect(hops[0]).toMatchObject({ status: 'found', tries: 2 });
    expect(events.map(e => e.type)).toEqual(['request', 'retry', 'request']);
    expect(events[0]).toMatchObject({ status: 502, error: { name: 'ServerError' } });
  });

  it('does not retry a response that will not change', async () => {
    const local = await server(json('<html>welcome</html>'));
    const client = new RdapWhois({ ...FAST, retries: 3 });
    await expect(
      client.rdap('example.com', { server: `http://127.0.0.1:${local.port}/` })
    ).rejects.toBeInstanceOf(InvalidResponseError);
    expect(local.requests).toHaveLength(1);
  });

  it('retries a 429 after the wait the server asks for', async () => {
    let calls = 0;
    const local = await server((request, response) =>
      ++calls === 1
        ? json('slow down', 429, { 'Retry-After': '0' })(request, response)
        : json(domain())(request, response)
    );
    const client = new RdapWhois(FAST);
    const hops = await client.rdap('example.com', { server: `http://127.0.0.1:${local.port}/` });
    expect(hops[0]).toMatchObject({ status: 'found', tries: 2 });
  });

  it('honours a Retry-After longer than the timeout, then asks again', async () => {
    let calls = 0;
    const local = await server((request, response) =>
      ++calls === 1
        ? json('slow down', 429, { 'Retry-After': '1' })(request, response)
        : json(domain())(request, response)
    );
    // the 1 s wait is longer than the 300 ms timeout: the retry still waits it out and
    // asks again, instead of timing out in the paused queue
    const client = new RdapWhois({ ...FAST, timeout: 300, retries: 1 });
    const hops = await client.rdap('example.com', { server: `http://127.0.0.1:${local.port}/` });
    expect(hops[0]).toMatchObject({ status: 'found', tries: 2 });
    expect(local.requests).toHaveLength(2);
  });

  it('gives up at once when the server asks for a long wait', async () => {
    const local = await server(json('slow down', 429, { 'Retry-After': '120' }));
    const client = new RdapWhois({ ...FAST, retries: 3 });
    const error = (await client
      .rdap('example.com', { server: `http://127.0.0.1:${local.port}/` })
      .catch((e: unknown) => e)) as RateLimitError;
    expect(error).toBeInstanceOf(RateLimitError);
    expect(error.retryAfter).toBe(120_000);
    expect(error.raw).toBe('slow down');
    expect(local.requests).toHaveLength(1);
  });

  it('treats a 429 in an RDAP error body as a throttle', async () => {
    const body = { rdapConformance: ['rdap_level_0'], errorCode: 429, title: 'Rate limited' };
    const local = await server(json(body, 429));
    const client = new RdapWhois({ ...FAST, retries: 0 });
    await expect(
      client.rdap('example.com', { server: `http://127.0.0.1:${local.port}/` })
    ).rejects.toBeInstanceOf(RateLimitError);
  });
});

describe('redirects', () => {
  const redirecting = async (location: (port: number) => string, status = 302) => {
    const local: HttpTestServer = await server((request, response) => {
      if (request.url?.startsWith('/moved/')) return json(domain())(request, response);
      response.writeHead(status, { Location: location(local.port) });
      response.end();
    });
    return local;
  };

  it('follows a redirect and reports where the answer came from', async () => {
    const local = await redirecting(port => `http://127.0.0.1:${port}/moved/domain/example.com`);
    const events: ClientEvent[] = [];
    const client = new RdapWhois({ ...FAST, onEvent: e => events.push(e) });
    const base = `http://127.0.0.1:${local.port}/`;
    const hops = await client.rdap('example.com', { server: base });

    expect(hops[0]).toMatchObject({
      status: 'found',
      url: `${base}domain/example.com`,
      finalUrl: `${base}moved/domain/example.com`,
    });
    expect(events.map(e => e.type)).toEqual(['request', 'redirect', 'request']);
    expect(events[0]).toMatchObject({ status: 302 });
    expect(events[1]).toMatchObject({
      from: `${base}domain/example.com`,
      to: `${base}moved/domain/example.com`,
      status: 302,
    });
  });

  it('follows a relative redirect', async () => {
    const local = await redirecting(() => '/moved/domain/example.com', 307);
    const client = new RdapWhois(FAST);
    const hops = await client.rdap('example.com', { server: `http://127.0.0.1:${local.port}/` });
    expect(hops[0]?.status).toBe('found');
  });

  it('reports the redirect as the error when redirects are off', async () => {
    const local = await redirecting(port => `http://127.0.0.1:${port}/moved/domain/example.com`);
    const client = new RdapWhois({ ...FAST, retries: 2 });
    const error = await client
      .rdap('example.com', { server: `http://127.0.0.1:${local.port}/`, followRedirects: 0 })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServerError);
    expect(error).toMatchObject({ status: 302, retryable: false });
    expect(local.requests).toHaveLength(1);
  });

  it('gives up on a redirect loop', async () => {
    const local = await redirecting(port => `http://127.0.0.1:${port}/again`);
    const client = new RdapWhois({ ...FAST, retries: 0 });
    const error = await client
      .rdap('example.com', { server: `http://127.0.0.1:${local.port}/`, followRedirects: 3 })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServerError);
    expect((error as Error).message).toMatch(/redirected more than 3 times/);
    expect(local.requests).toHaveLength(4);
  });

  it('does not follow a redirect to a URL that is not HTTP', async () => {
    const local = await redirecting(() => 'ftp://127.0.0.1/domain/example.com');
    const client = new RdapWhois({ ...FAST, retries: 0 });
    const error = (await client
      .rdap('example.com', { server: `http://127.0.0.1:${local.port}/` })
      .catch((e: unknown) => e)) as Error;
    expect(error).toBeInstanceOf(InvalidResponseError);
    expect(error.message).toMatch(/not an HTTP URL/);
  });
});

describe('redirects and the limiter', () => {
  // a registry that sends every domain query to the registrar
  const redirectingRegistry = (only = '') =>
    server((request, response) => {
      if (!request.url?.includes(only))
        return json(domain({ ldhName: 'EXAMPLE.NET' }))(request, response);
      response.writeHead(302, { Location: `${REGISTRAR}domain/example.com` });
      response.end();
    });

  it('waits its turn at the host a redirect points to', async () => {
    const registry = await redirectingRegistry();
    const started: number[] = [];
    const registrar = await server((request, response) => {
      started.push(Date.now());
      json(domain())(request, response);
    });
    const client = new RdapWhois({
      ...FAST,
      concurrency: 4,
      minInterval: 0,
      serverLimits: { 'rdap.example-registrar.com': { concurrency: 1, minInterval: 300 } },
      fetch: routing({ 'rdap.verisign.com': registry, 'rdap.example-registrar.com': registrar }),
    });

    await Promise.all([
      client.rdap('example.com', { followReferrals: 0 }),
      client.rdap('example.com', { followReferrals: 0 }),
    ]);

    // both went through the registry at once, but the registrar's spacing held them apart
    expect(started).toHaveLength(2);
    expect(started[1]! - started[0]!).toBeGreaterThanOrEqual(250);
  });

  it('pauses the host that throttled, not the one that redirected there', async () => {
    const registry = await redirectingRegistry('example.com');
    let calls = 0;
    const registrar = await server((request, response) =>
      ++calls === 1
        ? json('slow down', 429, { 'Retry-After': '1' })(request, response)
        : json(domain())(request, response)
    );
    const client = new RdapWhois({
      ...FAST,
      retries: 1,
      fetch: routing({ 'rdap.verisign.com': registry, 'rdap.example-registrar.com': registrar }),
    });

    // a call that will retry the throttle, left running while the pause is in force
    const first = client.rdap('example.com', { followReferrals: 0 });
    while (calls < 1) await new Promise(resolve => setTimeout(resolve, 5));

    // the registry is not held back
    let started = Date.now();
    await client.rdap('example.net', { server: REGISTRY, followReferrals: 0 });
    expect(Date.now() - started).toBeLessThan(500);

    // the registrar is
    started = Date.now();
    await client.rdap('example.com', { server: REGISTRAR, followReferrals: 0 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(500);
    await first;
  });

  it('waits out a throttle from the host a redirect led to before asking again', async () => {
    const registry = await redirectingRegistry();
    let calls = 0;
    const registrar = await server((request, response) =>
      ++calls === 1
        ? json('slow down', 429, { 'Retry-After': '1' })(request, response)
        : json(domain())(request, response)
    );
    // when each request to the registry went out
    const asked: number[] = [];
    const route = routing({
      'rdap.verisign.com': registry,
      'rdap.example-registrar.com': registrar,
    });
    const events: ClientEvent[] = [];
    const client = new RdapWhois({
      ...FAST,
      retries: 1,
      fetch: (url, init) => {
        if (new URL(url).hostname === 'rdap.verisign.com') asked.push(Date.now());
        return route(url, init);
      },
      onEvent: e => events.push(e),
    });

    const hops = await client.rdap('example.com', { followReferrals: 0 });

    expect(hops[0]).toMatchObject({ status: 'found', tries: 2 });
    // the retry did not go back to the registry until the registrar's wait was over
    expect(asked).toHaveLength(2);
    expect(asked[1]! - asked[0]!).toBeGreaterThanOrEqual(900);
    expect(events.find(e => e.type === 'retry')).toMatchObject({
      server: 'rdap.verisign.com',
      delay: 1000,
    });
  });

  it('follows a redirect back to the same host when that host allows one request at a time', async () => {
    const local: HttpTestServer = await server((request, response) => {
      if (request.url?.startsWith('/moved/')) return json(domain())(request, response);
      response.writeHead(302, {
        Location: `http://127.0.0.1:${local.port}/moved/domain/example.com`,
      });
      response.end();
    });
    const client = new RdapWhois({
      ...FAST,
      concurrency: 1,
      minInterval: 0,
    });
    const hops = await client.rdap('example.com', { server: `http://127.0.0.1:${local.port}/` });
    expect(hops[0]?.status).toBe('found');
    expect(local.requests).toHaveLength(2);
  });
});

describe('validation', () => {
  const ask = async (body: unknown, options: Record<string, unknown> = {}) => {
    const local = await server(json(body));
    const client = new RdapWhois({ ...FAST, retries: 2 });
    const result = await client
      .rdap('example.com', { server: `http://127.0.0.1:${local.port}/`, ...options })
      .catch((e: unknown) => e);
    return { result, local };
  };

  it('rejects a response about a different domain, without retrying', async () => {
    const { result, local } = await ask(domain({ ldhName: 'other.com' }));
    expect(result).toBeInstanceOf(InvalidResponseError);
    expect((result as Error).message).toMatch(/answered about "other.com", not "example.com"/);
    expect(local.requests).toHaveLength(1);
  });

  it('accepts it when validation is off', async () => {
    const { result } = await ask(domain({ ldhName: 'other.com' }), { validate: false });
    expect((result as unknown[])[0]).toMatchObject({ status: 'found' });
  });

  it('accepts a response that gives no name', async () => {
    const { result } = await ask(domain({ ldhName: undefined }));
    expect((result as unknown[])[0]).toMatchObject({ status: 'found' });
  });

  it('keeps a response whose registration date cannot be right', async () => {
    const { result } = await ask(
      domain({ events: [{ eventAction: 'registration', eventDate: '2999-01-01T00:00:00Z' }] })
    );
    expect((result as unknown[])[0]).toMatchObject({ status: 'found' });
  });
});

describe('transports', () => {
  it('uses the caller’s fetch when given one, and does not apply the proxy to it', async () => {
    const local = await server(json(domain()));
    let proxyAsked = 0;
    const client = new RdapWhois({
      ...FAST,
      fetch: routing({ 'rdap.verisign.com': local }),
      proxy: 'socks5://127.0.0.1:1',
      connect: () => {
        proxyAsked++;
        throw new Error('the proxy was not expected to be used');
      },
    });
    const hops = await client.rdap('example.com', { followReferrals: 0 });
    expect(hops[0]?.status).toBe('found');
    expect(proxyAsked).toBe(0);
  });

  it('goes through the proxy given for RDAP', async () => {
    const local = await server(json(domain()));
    const proxy = await startSocksProxy({
      resolve: () => ({ host: '127.0.0.1', port: local.port }),
    });
    servers.push(proxy);
    const events: ClientEvent[] = [];
    const client = new RdapWhois({
      ...FAST,
      proxy: { rdap: `socks5://127.0.0.1:${proxy.port}` },
      onEvent: e => events.push(e),
    });

    const hops = await client.rdap('example.com', { server: 'http://rdap.example-registry.com/' });
    expect(hops[0]).toMatchObject({ status: 'found', httpStatus: 200 });
    // the proxy was asked for the server by name, and the request went through it
    expect(proxy.requests).toEqual([{ host: 'rdap.example-registry.com', port: 80 }]);
    expect(local.requests[0]?.headers.host).toBe('rdap.example-registry.com');
    expect(events[0]).toMatchObject({ type: 'request', proxied: true, status: 200 });
  });
});

describe('where a query goes', () => {
  const capture = () => {
    const asked: string[] = [];
    const fetchLike: FetchLike = url => {
      asked.push(url);
      return Promise.resolve(
        new Response(JSON.stringify({ rdapConformance: ['rdap_level_0'], errorCode: 404 }), {
          status: 404,
        })
      );
    };
    return { asked, client: new RdapWhois({ ...FAST, fetch: fetchLike }) };
  };

  it('a domain goes to its registry from the bootstrap data', async () => {
    const { asked, client } = capture();
    await client.rdap('example.com');
    expect(asked).toEqual([`${REGISTRY}domain/example.com`]);
  });

  it('an IDN is asked for in its ASCII form', async () => {
    const { asked, client } = capture();
    await client.rdap('bücher.com');
    expect(asked).toEqual([`${REGISTRY}domain/xn--bcher-kva.com`]);
  });

  it('a bare TLD goes to IANA', async () => {
    const { asked, client } = capture();
    await client.rdap('com');
    expect(asked).toEqual(['https://rdap.iana.org/domain/com']);
  });

  it('an IP address and an AS number use their own paths', async () => {
    const { asked, client } = capture();
    await client.rdap('8.8.8.8');
    await client.rdap('AS15169');
    expect(asked[0]).toMatch(/\/ip\/8\.8\.8\.8$/);
    expect(asked[1]).toMatch(/\/autnum\/15169$/);
  });

  it('an IP address and an AS number go where IANA’s bootstrap files place them', async () => {
    const { asked, client } = capture();
    await client.rdap('8.8.8.8');
    await client.rdap('2001:4860:4860::8888');
    await client.rdap('AS3333');
    expect(asked[0]).toMatch(/^https:\/\/rdap\.arin\.net\//);
    expect(asked[1]).toMatch(/^https:\/\/rdap\.arin\.net\//);
    expect(asked[2]).toMatch(/^https:\/\/rdap\.db\.ripe\.net\//);
  });

  it('an AS number outside the bootstrap file is a NoServerError, not a guess', async () => {
    const { asked, client } = capture();
    // reserved for private use (RFC 6996), so no registry holds it
    await expect(client.rdap('AS4200000000')).rejects.toBeInstanceOf(NoServerError);
    expect(asked).toEqual([]);
  });

  it('an entity handle goes where its tag says', async () => {
    const { asked, client } = capture();
    await client.rdap('GOGL-ARIN', { queryType: 'entity' });
    await client.rdap('ORG-EXAMPLE1-RIPE', { queryType: 'entity' });
    expect(asked[0]).toBe('https://rdap.arin.net/registry/entity/GOGL-ARIN');
    expect(asked[1]).toMatch(/^https:\/\/rdap\.db\.ripe\.net\/entity\//);
  });

  it('an entity handle with no known tag needs a server', async () => {
    const { asked, client } = capture();
    const error = await client.rdap('ARIN-EXAMPLE', { queryType: 'entity' }).catch(e => e);
    expect(error).toBeInstanceOf(NoServerError);
    expect((error as Error).message).toMatch(/pass `server`/);
    await client.rdap('ARIN-EXAMPLE', {
      queryType: 'entity',
      server: 'https://rdap.arin.net/registry/',
    });
    expect(asked).toEqual(['https://rdap.arin.net/registry/entity/ARIN-EXAMPLE']);
  });

  it('a TLD with no RDAP server is a NoServerError', async () => {
    const { asked, client } = capture();
    await expect(client.rdap('example.de')).rejects.toBeInstanceOf(NoServerError);
    expect(asked).toEqual([]);
  });

  it('a server the caller names is asked as given, a local http:// one included', async () => {
    const { asked, client } = capture();
    await client.rdap('example.com', { server: 'http://127.0.0.1:8080/' });
    expect(asked).toEqual(['http://127.0.0.1:8080/domain/example.com']);
  });

  it('a server named as host:port gets https://', async () => {
    const { asked, client } = capture();
    await client.rdap('example.com', { server: 'rdap.example.org:8443' });
    expect(asked).toEqual(['https://rdap.example.org:8443/domain/example.com']);
  });

  it.each(['ftp://rdap.example.org/', 'not a host'])(
    'a server that is not an RDAP URL (%s) is an InvalidQueryError',
    async server => {
      const { asked, client } = capture();
      await expect(client.rdap('example.com', { server })).rejects.toBeInstanceOf(
        InvalidQueryError
      );
      expect(asked).toEqual([]);
    }
  );
});
