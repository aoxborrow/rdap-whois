// The tunnelled fetch against a local HTTP server: every way a body can be framed, the size
// cap, and TLS inside a proxy tunnel with the target's certificate checked.
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { ConnectionError, InvalidResponseError, TimeoutError } from '../../src/errors';
import { parseProxy } from '../../src/net/proxy';
import { openConnection } from '../../src/net/tunnel';
import { createProxyFetch } from '../../src/net/proxy-fetch';
import { createConnect } from '../../src/transports/node';
import {
  startHttpProxy,
  startHttpServer,
  startSocksProxy,
  testCertificate,
  type TestServer,
} from '../support/servers';

const servers: TestServer[] = [];
const started = <T extends TestServer>(server: T): T => {
  servers.push(server);
  return server;
};
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => server.close()));
});

const certificate = testCertificate();
// trust the test certificate, and nothing else, for the TLS upgrade
const connect = createConnect(certificate ? { tls: { ca: certificate.cert } } : {});

const BODY = JSON.stringify({ objectClassName: 'domain', ldhName: 'example.test' });

function fetcher(proxyUrl?: string, limits: { timeout?: number; max?: number } = {}) {
  return createProxyFetch({
    open: (target, signal) =>
      openConnection(target, {
        connect,
        proxy: proxyUrl ? parseProxy(proxyUrl) : undefined,
        timeout: 2000,
        signal,
      }),
    timeout: limits.timeout ?? 2000,
    maxResponseBytes: limits.max ?? 1_000_000,
  });
}

describe('reading a response', () => {
  it('reads a body framed by Content-Length', async () => {
    const server = started(
      await startHttpServer((_, response) => {
        response.writeHead(200, {
          'Content-Type': 'application/rdap+json',
          'Content-Length': Buffer.byteLength(BODY),
        });
        response.end(BODY);
      })
    );
    const response = await fetcher()(`http://127.0.0.1:${server.port}/domain/example.test?x=1`, {
      headers: { 'Accept': 'application/rdap+json', 'User-Agent': 'test-agent' },
    });

    expect(response.status).toBe(200);
    expect(response.ok).toBe(true);
    expect(response.headers.get('content-type')).toBe('application/rdap+json');
    expect(response.url).toBe(`http://127.0.0.1:${server.port}/domain/example.test?x=1`);
    expect(await response.json()).toEqual(JSON.parse(BODY));

    // one GET, to the path and query asked for, closing the connection after
    expect(server.requests).toHaveLength(1);
    const [request] = server.requests;
    expect(request?.method).toBe('GET');
    expect(request?.url).toBe('/domain/example.test?x=1');
    expect(request?.headers.host).toBe(`127.0.0.1:${server.port}`);
    expect(request?.headers.accept).toBe('application/rdap+json');
    expect(request?.headers['user-agent']).toBe('test-agent');
    expect(request?.headers.connection).toBe('close');
    expect(request?.headers['accept-encoding']).toBe('gzip');
  });

  it('reads a chunked body', async () => {
    const server = started(
      await startHttpServer((_, response) => {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.write(BODY.slice(0, 10));
        response.write(BODY.slice(10));
        response.end();
      })
    );
    const response = await fetcher()(`http://127.0.0.1:${server.port}/`);
    expect(await response.text()).toBe(BODY);
  });

  it('reads a body that ends when the connection closes', async () => {
    const server = started(
      await startHttpServer((request, response) => {
        // no length and no chunking: write the raw response and close
        request.socket.end(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n${BODY}`);
        void response;
      })
    );
    const response = await fetcher()(`http://127.0.0.1:${server.port}/`);
    expect(await response.text()).toBe(BODY);
  });

  it('inflates a gzipped body', async () => {
    const server = started(
      await startHttpServer((_, response) => {
        const compressed = gzipSync(BODY);
        response.writeHead(200, {
          'Content-Encoding': 'gzip',
          'Content-Length': compressed.length,
        });
        response.end(compressed);
      })
    );
    const response = await fetcher()(`http://127.0.0.1:${server.port}/`);
    expect(await response.text()).toBe(BODY);
  });

  it('reads past informational responses to the real one', async () => {
    const server = started(
      await startHttpServer(request => {
        request.socket.end(
          'HTTP/1.1 103 Early Hints\r\nLink: </style.css>; rel=preload\r\n\r\n' +
            'HTTP/1.1 100 Continue\r\n\r\n' +
            `HTTP/1.1 200 OK\r\nContent-Type: application/rdap+json\r\nContent-Length: ${Buffer.byteLength(BODY)}\r\n\r\n${BODY}`
        );
      })
    );
    const response = await fetcher()(`http://127.0.0.1:${server.port}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/rdap+json');
    expect(await response.text()).toBe(BODY);
  });

  it('gives up on a server that only ever sends informational responses', async () => {
    const server = started(
      await startHttpServer(request => {
        request.socket.end('HTTP/1.1 103 Early Hints\r\n\r\n'.repeat(20));
      })
    );
    await expect(fetcher()(`http://127.0.0.1:${server.port}/`)).rejects.toBeInstanceOf(
      InvalidResponseError
    );
  });

  it('returns an error status with its body, for the caller to read', async () => {
    const server = started(
      await startHttpServer((_, response) => {
        response.writeHead(404, { 'Content-Type': 'application/rdap+json' });
        response.end('{"errorCode":404,"title":"Not Found"}');
      })
    );
    const response = await fetcher()(`http://127.0.0.1:${server.port}/domain/nope.test`);
    expect(response.status).toBe(404);
    expect(response.ok).toBe(false);
    expect(await response.json()).toEqual({ errorCode: 404, title: 'Not Found' });
  });

  it('returns a redirect as it is, without following it', async () => {
    const server = started(
      await startHttpServer((_, response) => {
        response.writeHead(302, { Location: 'https://rdap.example.test/domain/example.test' });
        response.end();
      })
    );
    const response = await fetcher()(`http://127.0.0.1:${server.port}/`);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://rdap.example.test/domain/example.test');
    expect(server.requests).toHaveLength(1);
  });

  it('returns a response with no body', async () => {
    const server = started(
      await startHttpServer((_, response) => {
        response.writeHead(204);
        response.end();
      })
    );
    const response = await fetcher()(`http://127.0.0.1:${server.port}/`);
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
  });

  it('retries nothing and pools nothing: each call is its own connection', async () => {
    const server = started(await startHttpServer((_, response) => response.end(BODY)));
    const proxyFetch = fetcher();
    await proxyFetch(`http://127.0.0.1:${server.port}/one`);
    await proxyFetch(`http://127.0.0.1:${server.port}/two`);
    expect(server.requests.map(request => request.url)).toEqual(['/one', '/two']);
  });
});

describe('limits', () => {
  it('refuses a body whose declared length is over the cap, without reading it', async () => {
    const server = started(
      await startHttpServer((_, response) => {
        response.writeHead(200, { 'Content-Length': 5_000_000 });
        response.end(Buffer.alloc(5_000_000, 0x61));
      })
    );
    await expect(
      fetcher(undefined, { max: 10_000 })(`http://127.0.0.1:${server.port}/`)
    ).rejects.toBeInstanceOf(InvalidResponseError);
  });

  it('stops reading a chunked body at the cap', async () => {
    let sent = 0;
    let closed = false;
    const server = started(
      await startHttpServer((request, response) => {
        // an endless body: the only way this request ends is the client giving up
        const chunk = Buffer.alloc(16_384, 0x61);
        response.writeHead(200);
        const timer = setInterval(() => {
          sent += chunk.length;
          response.write(chunk);
        }, 1);
        request.socket.on('close', () => {
          closed = true;
          clearInterval(timer);
        });
      })
    );
    await expect(
      fetcher(undefined, { max: 100_000 })(`http://127.0.0.1:${server.port}/`)
    ).rejects.toBeInstanceOf(InvalidResponseError);

    // the client closed the connection, and the server had not got far past the cap
    await expect.poll(() => closed).toBe(true);
    expect(sent).toBeLessThan(5_000_000);
  });

  it('refuses a small gzipped body that inflates past the cap', async () => {
    const server = started(
      await startHttpServer((_, response) => {
        const bomb = gzipSync(Buffer.alloc(5_000_000, 0x61));
        response.writeHead(200, { 'Content-Encoding': 'gzip', 'Content-Length': bomb.length });
        response.end(bomb);
      })
    );
    await expect(
      fetcher(undefined, { max: 100_000 })(`http://127.0.0.1:${server.port}/`)
    ).rejects.toBeInstanceOf(InvalidResponseError);
  });

  it('times out when the server never answers', async () => {
    const server = started(await startHttpServer(() => {}));
    await expect(
      fetcher(undefined, { timeout: 100 })(`http://127.0.0.1:${server.port}/`)
    ).rejects.toBeInstanceOf(TimeoutError);
  });

  it('reports a server that closes without answering as a ConnectionError', async () => {
    const server = started(await startHttpServer(request => request.socket.destroy()));
    await expect(fetcher()(`http://127.0.0.1:${server.port}/`)).rejects.toBeInstanceOf(
      ConnectionError
    );
  });

  it('does not let a header value add a header', async () => {
    const server = started(await startHttpServer((_, response) => response.end(BODY)));
    await expect(
      fetcher()(`http://127.0.0.1:${server.port}/`, {
        headers: { 'User-Agent': 'x\r\nX-Injected: 1' },
      })
    ).rejects.toBeInstanceOf(TypeError);
  });
});

// TLS inside the tunnel: the connection is opened to the proxy, and the certificate has to
// be checked against the target's name, not the proxy's
describe.skipIf(!certificate)('https through a proxy', () => {
  const hostname = certificate?.hostname ?? '';
  const url = `https://${hostname}/domain/example.test`;

  const rdapServer = async () =>
    started(
      await startHttpServer((_, response) => {
        response.writeHead(200, { 'Content-Type': 'application/rdap+json' });
        response.end(BODY);
      }, certificate!)
    );

  it('works through SOCKS5', async () => {
    const rdap = await rdapServer();
    const proxy = started(
      await startSocksProxy({ resolve: () => ({ host: '127.0.0.1', port: rdap.port }) })
    );
    const response = await fetcher(`socks5://127.0.0.1:${proxy.port}`)(url);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(JSON.parse(BODY));
    // the proxy was asked for the target by name on the HTTPS port
    expect(proxy.requests).toEqual([{ host: hostname, port: 443 }]);
    expect(rdap.requests[0]?.headers.host).toBe(hostname);
  });

  it('works through HTTP CONNECT', async () => {
    const rdap = await rdapServer();
    const proxy = started(
      await startHttpProxy({ resolve: () => ({ host: '127.0.0.1', port: rdap.port }) })
    );
    const response = await fetcher(`http://127.0.0.1:${proxy.port}`)(url);
    expect(await response.json()).toEqual(JSON.parse(BODY));
    expect(proxy.requests).toEqual([{ host: hostname, port: 443 }]);
  });

  it('rejects a certificate that is for a different name', async () => {
    const rdap = await rdapServer();
    const proxy = started(
      await startSocksProxy({ resolve: () => ({ host: '127.0.0.1', port: rdap.port }) })
    );
    // the server's certificate is for rdap.example.test, not this name
    const error = await fetcher(`socks5://127.0.0.1:${proxy.port}`)(
      'https://other.example.test/domain/example.test'
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectionError);
    expect((error as Error).message).toMatch(/TLS handshake/);
    expect(rdap.requests).toHaveLength(0);
  });

  it('rejects a certificate the runtime does not trust', async () => {
    const rdap = await rdapServer();
    const proxy = started(
      await startSocksProxy({ resolve: () => ({ host: '127.0.0.1', port: rdap.port }) })
    );
    // the default transport does not know the test certificate
    const untrusting = createProxyFetch({
      open: target =>
        openConnection(target, {
          connect: createConnect(),
          proxy: parseProxy(`socks5://127.0.0.1:${proxy.port}`),
          timeout: 2000,
        }),
      timeout: 2000,
      maxResponseBytes: 1_000_000,
    });
    await expect(untrusting(url)).rejects.toBeInstanceOf(ConnectionError);
    expect(rdap.requests).toHaveLength(0);
  });
});
