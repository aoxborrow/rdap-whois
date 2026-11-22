// A WHOIS exchange over every way of opening a connection: direct, through SOCKS5 and
// through HTTP CONNECT, including each way a proxy or a target can fail.
import { afterEach, describe, expect, it } from 'vitest';
import { ConnectionError, InvalidResponseError, ProxyError, TimeoutError } from '../../src/errors';
import { parseProxy } from '../../src/net/proxy';
import { openConnection } from '../../src/net/tunnel';
import { connect } from '../../src/transports/node';
import { whoisExchange } from '../../src/whois/socket';
import {
  closedPort,
  startHttpProxy,
  startSocksProxy,
  startWhoisServer,
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

const EXCHANGE = { timeout: 2000, maxResponseBytes: 1_000_000 };
const RECORD = 'Domain Name: EXAMPLE.TEST\r\nRegistrar: Example Registrar\r\n';

// a target name that only the test proxies know how to reach
const TARGET = 'whois.example.test';
const toLocal = (port: number) => () => ({ host: '127.0.0.1', port });

async function query(
  target: { host: string; port: number },
  proxyUrl?: string,
  timeout = 2000
): Promise<string> {
  const connection = await openConnection(target, {
    connect,
    proxy: proxyUrl ? parseProxy(proxyUrl) : undefined,
    timeout,
  });
  return whoisExchange(connection, 'example.test', EXCHANGE);
}

describe('a direct connection', () => {
  it('sends the query line and returns what the server sent', async () => {
    const whois = started(await startWhoisServer(() => RECORD));
    expect(await query(whois)).toBe(RECORD);
    expect(whois.queries).toEqual(['example.test']);
  });

  it('returns an empty string when the server closes without answering', async () => {
    const whois = started(await startWhoisServer(() => ''));
    expect(await query(whois)).toBe('');
  });

  it('reports a refused connection as a ConnectionError', async () => {
    const port = await closedPort();
    await expect(query({ host: '127.0.0.1', port })).rejects.toBeInstanceOf(ConnectionError);
  });

  it('times out when the server never answers', async () => {
    const whois = started(await startWhoisServer(() => ({ hang: true })));
    const connection = await openConnection(whois, { connect, timeout: 2000 });
    await expect(
      whoisExchange(connection, 'example.test', { timeout: 100, maxResponseBytes: 1000 })
    ).rejects.toBeInstanceOf(TimeoutError);
  });

  it('times out when the server answers and then never closes', async () => {
    const whois = started(await startWhoisServer(() => ({ text: RECORD, stall: true })));
    const connection = await openConnection(whois, { connect, timeout: 2000 });
    await expect(
      whoisExchange(connection, 'example.test', { timeout: 100, maxResponseBytes: 1000 })
    ).rejects.toBeInstanceOf(TimeoutError);
  });

  it('reports a connection cut mid-response as a ConnectionError', async () => {
    const whois = started(await startWhoisServer(() => ({ text: 'Domain Name: EX', reset: true })));
    await expect(query(whois)).rejects.toBeInstanceOf(ConnectionError);
  });

  it('stops reading at the size cap', async () => {
    // far more than the cap, and more than a socket buffer would swallow in one go
    const whois = started(await startWhoisServer(() => 'x'.repeat(8_000_000)));
    const connection = await openConnection(whois, { connect, timeout: 2000 });
    await expect(
      whoisExchange(connection, 'example.test', { timeout: 2000, maxResponseBytes: 10_000 })
    ).rejects.toBeInstanceOf(InvalidResponseError);
  });

  it('decodes the response in the encoding asked for', async () => {
    const whois = started(await startWhoisServer(() => Uint8Array.of(0x63, 0x61, 0x66, 0xe9)));
    const connection = await openConnection(whois, { connect, timeout: 2000 });
    expect(
      await whoisExchange(connection, 'example.test', { ...EXCHANGE, encoding: 'latin1' })
    ).toBe('café');
  });

  it('stops when the caller aborts', async () => {
    const whois = started(await startWhoisServer(() => ({ hang: true })));
    const controller = new AbortController();
    const connection = await openConnection(whois, { connect, timeout: 2000 });
    const pending = whoisExchange(connection, 'example.test', {
      ...EXCHANGE,
      signal: controller.signal,
    });
    controller.abort(new Error('caller gave up'));
    await expect(pending).rejects.toThrow('caller gave up');
  });
});

describe('through a SOCKS5 proxy', () => {
  it('tunnels to the target by name, with no credentials', async () => {
    const whois = started(await startWhoisServer(() => RECORD));
    const proxy = started(await startSocksProxy({ resolve: toLocal(whois.port) }));

    expect(await query({ host: TARGET, port: 43 }, `socks5://127.0.0.1:${proxy.port}`)).toBe(
      RECORD
    );
    // the name went to the proxy to resolve, and the query went through the tunnel
    expect(proxy.requests).toEqual([{ host: TARGET, port: 43 }]);
    expect(whois.queries).toEqual(['example.test']);
  });

  it('authenticates with a username and password', async () => {
    const whois = started(await startWhoisServer(() => RECORD));
    const proxy = started(
      await startSocksProxy({
        username: 'user',
        password: 'p@ss:word',
        resolve: toLocal(whois.port),
      })
    );
    const url = `socks5://user:${encodeURIComponent('p@ss:word')}@127.0.0.1:${proxy.port}`;

    expect(await query({ host: TARGET, port: 43 }, url)).toBe(RECORD);
    expect(proxy.credentials).toEqual([{ username: 'user', password: 'p@ss:word' }]);
  });

  it('sends an IPv4 target as an address', async () => {
    const whois = started(await startWhoisServer(() => RECORD));
    const proxy = started(await startSocksProxy());
    expect(await query(whois, `socks5://127.0.0.1:${proxy.port}`)).toBe(RECORD);
    expect(proxy.requests).toEqual([{ host: '127.0.0.1', port: whois.port }]);
  });

  it('reports rejected credentials as a ProxyError', async () => {
    const proxy = started(await startSocksProxy({ username: 'user', password: 'right' }));
    const error = await query(
      { host: TARGET, port: 43 },
      `socks5://user:wrong@127.0.0.1:${proxy.port}`
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProxyError);
    expect((error as Error).message).toMatch(/username or password/);
  });

  it('reports a proxy that needs credentials we do not have as a ProxyError', async () => {
    const proxy = started(await startSocksProxy({ username: 'user', password: 'right' }));
    await expect(
      query({ host: TARGET, port: 43 }, `socks5://127.0.0.1:${proxy.port}`)
    ).rejects.toThrow(/requires authentication/);
  });

  it('reports a target the proxy could not reach as a ConnectionError', async () => {
    const proxy = started(await startSocksProxy({ reply: 0x05 }));
    const error = await query({ host: TARGET, port: 43 }, `socks5://127.0.0.1:${proxy.port}`).catch(
      (e: unknown) => e
    );
    expect(error).toBeInstanceOf(ConnectionError);
    expect((error as Error).message).toMatch(/whois\.example\.test:43: connection refused/);
    // and says the proxy is the one that reported it
    expect((error as ConnectionError).viaProxy).toBe(true);
  });

  it('reports a tunnel the proxy would not open as a ProxyError', async () => {
    const proxy = started(await startSocksProxy({ reply: 0x02 }));
    await expect(
      query({ host: TARGET, port: 43 }, `socks5://127.0.0.1:${proxy.port}`)
    ).rejects.toBeInstanceOf(ProxyError);
  });

  it('reports an unreachable proxy as a ProxyError', async () => {
    const port = await closedPort();
    await expect(
      query({ host: TARGET, port: 43 }, `socks5://127.0.0.1:${port}`)
    ).rejects.toBeInstanceOf(ProxyError);
  });

  it('reports a proxy that drops the connection as a ProxyError', async () => {
    const proxy = started(await startSocksProxy({ drop: true }));
    await expect(
      query({ host: TARGET, port: 43 }, `socks5://127.0.0.1:${proxy.port}`)
    ).rejects.toBeInstanceOf(ProxyError);
  });

  it('times out when the proxy never finishes the handshake', async () => {
    const proxy = started(await startSocksProxy({ hang: true }));
    const error = await query(
      { host: TARGET, port: 43 },
      `socks5://127.0.0.1:${proxy.port}`,
      100
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TimeoutError);
    // the time ran out on the proxy's side of the connection, not the target's
    expect((error as TimeoutError).viaProxy).toBe(true);
  });

  it('uses the proxy connect timeout when one is given', async () => {
    const proxy = started(await startSocksProxy({ hang: true }));
    const started_at = Date.now();
    await expect(
      openConnection(
        { host: TARGET, port: 43 },
        {
          connect,
          proxy: parseProxy({ url: `socks5://127.0.0.1:${proxy.port}`, connectTimeout: 100 }),
          timeout: 30_000,
        }
      )
    ).rejects.toBeInstanceOf(TimeoutError);
    expect(Date.now() - started_at).toBeLessThan(5000);
  });

  it('carries a failure of the target through the tunnel', async () => {
    const whois = started(await startWhoisServer(() => ({ text: 'Domain', reset: true })));
    const proxy = started(await startSocksProxy({ resolve: toLocal(whois.port) }));
    const error = await query({ host: TARGET, port: 43 }, `socks5://127.0.0.1:${proxy.port}`).catch(
      (e: unknown) => e
    );
    expect(error).toBeInstanceOf(ConnectionError);
    // the tunnel was open: this one is the target's own doing
    expect((error as ConnectionError).viaProxy).toBe(false);
  });
});

describe('through an HTTP CONNECT proxy', () => {
  it('tunnels to the target by name', async () => {
    const whois = started(await startWhoisServer(() => RECORD));
    const proxy = started(await startHttpProxy({ resolve: toLocal(whois.port) }));

    expect(await query({ host: TARGET, port: 43 }, `http://127.0.0.1:${proxy.port}`)).toBe(RECORD);
    expect(proxy.requests).toEqual([{ host: TARGET, port: 43 }]);
  });

  it('sends the credentials as basic authentication', async () => {
    const whois = started(await startWhoisServer(() => RECORD));
    const proxy = started(
      await startHttpProxy({ username: 'user', password: 'secret', resolve: toLocal(whois.port) })
    );
    expect(
      await query({ host: TARGET, port: 43 }, `http://user:secret@127.0.0.1:${proxy.port}`)
    ).toBe(RECORD);
    expect(proxy.credentials).toEqual([{ username: 'user', password: 'secret' }]);
  });

  it('reports rejected credentials as a ProxyError', async () => {
    const proxy = started(await startHttpProxy({ username: 'user', password: 'right' }));
    await expect(
      query({ host: TARGET, port: 43 }, `http://user:wrong@127.0.0.1:${proxy.port}`)
    ).rejects.toThrow(/username or password/);
  });

  it('reports a 502 from the proxy as the target being unreachable', async () => {
    const proxy = started(await startHttpProxy({ status: 502 }));
    const error = await query({ host: TARGET, port: 43 }, `http://127.0.0.1:${proxy.port}`).catch(
      (e: unknown) => e
    );
    expect(error).toBeInstanceOf(ConnectionError);
    expect((error as ConnectionError).viaProxy).toBe(true);
  });

  it('reports a 403 from the proxy as a ProxyError', async () => {
    const proxy = started(await startHttpProxy({ status: 403 }));
    await expect(
      query({ host: TARGET, port: 43 }, `http://127.0.0.1:${proxy.port}`)
    ).rejects.toBeInstanceOf(ProxyError);
  });

  it('reports a proxy that drops the connection as a ProxyError', async () => {
    const proxy = started(await startHttpProxy({ drop: true }));
    await expect(
      query({ host: TARGET, port: 43 }, `http://127.0.0.1:${proxy.port}`)
    ).rejects.toBeInstanceOf(ProxyError);
  });
});

describe('proxy credentials', () => {
  it('never appear in an error', async () => {
    const proxy = started(await startSocksProxy({ username: 'user', password: 'right' }));
    const error = (await query(
      { host: TARGET, port: 43 },
      `socks5://user:hunter2@127.0.0.1:${proxy.port}`
    ).catch((e: unknown) => e)) as Error;
    expect(JSON.stringify({ message: error.message, cause: String(error.cause) })).not.toContain(
      'hunter2'
    );
  });
});
