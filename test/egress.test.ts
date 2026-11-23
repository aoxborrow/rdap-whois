// The address check at the final connection (AAR-32): every address a server's name
// resolves to must be public, and the connection goes to those addresses and never to the
// name, for WHOIS and RDAP, direct and through a proxy, for the first server, referrals and
// redirects. The resolver is a stand-in, so nothing here asks real DNS.
import { afterEach, describe, expect, it } from 'vitest';
import { RdapWhois } from '../src/client';
import { BlockedTargetError, ConnectionError } from '../src/errors';
import { parseProxy } from '../src/net/proxy';
import { openConnection } from '../src/net/tunnel';
import type { Connect, Resolve } from '../src/net/types';
import { connect as nodeConnect, createConnect } from '../src/transports/node';
import { whoisExchange } from '../src/whois/socket';
import {
  startHttpProxy,
  startHttpServer,
  startSocksProxy,
  startWhoisServer,
  testCertificate,
  type TestServer,
} from './support/servers';

const servers: TestServer[] = [];
const started = <T extends TestServer>(server: T): T => {
  servers.push(server);
  return server;
};
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => server.close()));
});

const FAST = { backoff: 1, concurrency: 4, minInterval: 0, retries: 2 };
const RECORD = 'Domain Name: EXAMPLE.COM\r\nRegistrar: Example Registrar\r\n';
// a registry's answer that refers on to the registrar's server
const REFERRING_RECORD = [
  '   Domain Name: EXAMPLE.COM',
  '   Registrar WHOIS Server: whois.evil-registrar.com',
  '   Creation Date: 1995-08-14T04:00:00Z',
  '   Registrar: Example Registrar, Inc.',
  '   Name Server: A.IANA-SERVERS.NET',
  '',
].join('\r\n');

// a resolver that answers from a table, and remembers every name it was asked for
function resolver(table: Record<string, string[]>) {
  const asked: string[] = [];
  const resolve: Resolve = host => {
    asked.push(host);
    return Promise.resolve(table[host] ?? []);
  };
  return { resolve, asked };
}

// a connect that sends public test addresses to local servers, and remembers every host it
// was asked to connect to
function router(routes: Record<string, { host: string; port: number }>) {
  const contacted: string[] = [];
  const connect: Connect = (target, options) => {
    contacted.push(target.host);
    const route = routes[target.host];
    if (!route) return Promise.reject(new ConnectionError(`no route to ${target.host}`));
    return nodeConnect({ host: route.host, port: route.port }, options);
  };
  return { connect, contacted };
}

describe('a direct connection', () => {
  it.each([
    ['loopback', ['127.0.0.1']],
    ['cloud metadata', ['169.254.169.254']],
    ['a private network', ['10.0.0.5']],
    ['IPv6 loopback', ['::1']],
    ['an IPv4-mapped IPv6 loopback', ['::ffff:127.0.0.1']],
    ['unique-local IPv6', ['fd00::1']],
    ['one private address among public ones', ['93.184.215.1', '10.0.0.5']],
  ])('refuses a name that resolves to %s, and never connects', async (_, addresses) => {
    const { resolve } = resolver({ 'whois.example.com': addresses });
    const { connect, contacted } = router({});
    const error = await openConnection(
      { host: 'whois.example.com', port: 43 },
      { connect, resolve, timeout: 1000 }
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BlockedTargetError);
    expect(error).toMatchObject({ retryable: false, server: 'whois.example.com' });
    expect((error as Error).message).toMatch(/is not a public address/);
    expect(contacted).toEqual([]);
  });

  it.each(['127.0.0.1', '169.254.169.254', '::ffff:169.254.169.254', '[::1]'])(
    'refuses the literal address %s without resolving it',
    async host => {
      const { resolve, asked } = resolver({});
      const { connect, contacted } = router({});
      await expect(
        openConnection({ host, port: 43 }, { connect, resolve, timeout: 1000 })
      ).rejects.toBeInstanceOf(BlockedTargetError);
      expect(asked).toEqual([]);
      expect(contacted).toEqual([]);
    }
  );

  it('connects to the checked address, not the name, IPv4 first, moving on when one fails', async () => {
    const whois = started(await startWhoisServer(() => RECORD));
    const { resolve } = resolver({
      'whois.example.com': ['2001:500:8f::53', '93.184.215.1', '93.184.215.2'],
    });
    // the first IPv4 address has nothing listening; the second does
    const { connect, contacted } = router({ '93.184.215.2': whois });
    const connection = await openConnection(
      { host: 'whois.example.com', port: 43 },
      { connect, resolve, timeout: 1000 }
    );
    expect(
      await whoisExchange(connection, 'example.com', { timeout: 1000, maxResponseBytes: 1e6 })
    ).toBe(RECORD);
    expect(contacted).toEqual(['93.184.215.1', '93.184.215.2']);
  });

  it('gives each address a share of the time, so one that drops the attempt does not use it all', async () => {
    const whois = started(await startWhoisServer(() => RECORD));
    const { resolve } = resolver({ 'whois.example.com': ['93.184.215.1', '93.184.215.2'] });
    const tried: { host: string; timeout?: number }[] = [];
    // the first address never answers the connection attempt
    const connect: Connect = (target, options) => {
      tried.push({ host: target.host, timeout: options?.timeout });
      if (target.host === '93.184.215.1')
        return nodeConnect({ host: '10.255.255.1', port: 43 }, options);
      return nodeConnect({ host: '127.0.0.1', port: whois.port }, options);
    };
    const connection = await openConnection(
      { host: 'whois.example.com', port: 43 },
      { connect, resolve, timeout: 600 }
    );
    expect(
      await whoisExchange(connection, 'example.com', { timeout: 1000, maxResponseBytes: 1e6 })
    ).toBe(RECORD);
    expect(tried).toEqual([
      { host: '93.184.215.1', timeout: 300 },
      { host: '93.184.215.2', timeout: 300 },
    ]);
  });

  it('hands the name on unresolved when there is no resolver', async () => {
    const { connect, contacted } = router({});
    await openConnection({ host: 'whois.example.com', port: 43 }, { connect, timeout: 1000 }).catch(
      () => {}
    );
    expect(contacted).toEqual(['whois.example.com']);
  });
});

describe('through a proxy', () => {
  it.each([
    ['SOCKS5', startSocksProxy, 'socks5'],
    ['HTTP CONNECT', startHttpProxy, 'http'],
  ] as const)(
    'asks a %s proxy for the checked address, never the name',
    async (_, start, scheme) => {
      const whois = started(await startWhoisServer(() => RECORD));
      const proxy = started(
        await start({ resolve: () => ({ host: '127.0.0.1', port: whois.port }) })
      );
      const { resolve } = resolver({ 'whois.example.com': ['93.184.215.1'] });
      const connection = await openConnection(
        { host: 'whois.example.com', port: 43 },
        {
          connect: nodeConnect,
          proxy: parseProxy(`${scheme}://127.0.0.1:${proxy.port}`),
          resolve,
          timeout: 1000,
        }
      );
      expect(
        await whoisExchange(connection, 'example.com', { timeout: 1000, maxResponseBytes: 1e6 })
      ).toBe(RECORD);
      expect(proxy.requests).toEqual([{ host: '93.184.215.1', port: 43 }]);
    }
  );

  it('moves on to the next checked address when the proxy cannot reach one', async () => {
    const whois = started(await startWhoisServer(() => RECORD));
    const proxy = started(
      await startSocksProxy({
        resolve: () => ({ host: '127.0.0.1', port: whois.port }),
        // host unreachable for the first address
        reply: host => (host === '93.184.215.1' ? 0x04 : undefined),
      })
    );
    const { resolve } = resolver({ 'whois.example.com': ['93.184.215.1', '93.184.215.2'] });
    const connection = await openConnection(
      { host: 'whois.example.com', port: 43 },
      {
        connect: nodeConnect,
        proxy: parseProxy(`socks5://127.0.0.1:${proxy.port}`),
        resolve,
        timeout: 1000,
      }
    );
    expect(
      await whoisExchange(connection, 'example.com', { timeout: 1000, maxResponseBytes: 1e6 })
    ).toBe(RECORD);
    expect(proxy.requests.map(request => request.host)).toEqual(['93.184.215.1', '93.184.215.2']);
  });

  it('refuses a name that resolves to a private address before reaching the proxy', async () => {
    const proxy = started(await startSocksProxy({}));
    const { resolve } = resolver({ 'whois.example.com': ['169.254.169.254'] });
    const { connect, contacted } = router({});
    await expect(
      openConnection(
        { host: 'whois.example.com', port: 43 },
        { connect, proxy: parseProxy(`socks5://127.0.0.1:${proxy.port}`), resolve, timeout: 1000 }
      )
    ).rejects.toBeInstanceOf(BlockedTargetError);
    expect(contacted).toEqual([]);
    expect(proxy.requests).toEqual([]);
  });
});

describe('whois()', () => {
  it('refuses a first server whose name resolves to a private address, without retrying', async () => {
    const { resolve, asked } = resolver({ 'whois.example.com': ['127.0.0.1'] });
    const { connect, contacted } = router({});
    const client = new RdapWhois({ ...FAST, connect, resolve });
    const error = await client
      .whois('example.com', { server: 'whois.example.com' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BlockedTargetError);
    expect(error).toMatchObject({ protocol: 'whois', retryable: false, tries: 1 });
    expect(asked).toEqual(['whois.example.com']);
    expect(contacted).toEqual([]);
  });

  it('refuses a referral to a name that resolves to a private address, and keeps the answer before it', async () => {
    const registry = started(await startWhoisServer(() => REFERRING_RECORD));
    const { resolve } = resolver({
      'whois.verisign-grs.com': ['93.184.215.1'],
      'whois.evil-registrar.com': ['fd00::1'],
    });
    const { connect, contacted } = router({ '93.184.215.1': registry });
    const client = new RdapWhois({ ...FAST, connect, resolve });
    const hops = await client.whois('example.com');
    expect(hops.map(hop => [hop.server, hop.status])).toEqual([
      ['whois.verisign-grs.com', 'found'],
      ['whois.evil-registrar.com', 'error'],
    ]);
    expect(hops[1]).toMatchObject({
      tries: 1,
      error: { name: 'BlockedTargetError', retryable: false },
    });
    expect(contacted).toEqual(['93.184.215.1']);
  });

  it('refuses through the proxy too', async () => {
    const proxy = started(await startSocksProxy({}));
    const { resolve } = resolver({ 'whois.example.com': ['10.0.0.5'] });
    const client = new RdapWhois({ ...FAST, resolve, proxy: `socks5://127.0.0.1:${proxy.port}` });
    await expect(
      client.whois('example.com', { server: 'whois.example.com' })
    ).rejects.toBeInstanceOf(BlockedTargetError);
    expect(proxy.requests).toEqual([]);
  });

  it('checks nothing when the policy allows private targets', async () => {
    const whois = started(await startWhoisServer(() => RECORD));
    const { resolve, asked } = resolver({});
    const client = new RdapWhois({ ...FAST, resolve, targets: { allowPrivate: true } });
    const hops = await client.whois('example.com', {
      server: '127.0.0.1',
      port: whois.port,
      followReferrals: 0,
    });
    expect(hops[0]?.status).toBe('found');
    expect(asked).toEqual([]);
  });
});

describe('rdap()', () => {
  const DOMAIN = {
    rdapConformance: ['rdap_level_0'],
    objectClassName: 'domain',
    ldhName: 'example.com',
    status: ['active'],
  };

  it('refuses a redirect to a name that resolves to a private address', async () => {
    const registry = started(
      await startHttpServer((_, response) => {
        response.writeHead(302, { Location: 'http://rdap.evil.example/domain/example.com' });
        response.end();
      })
    );
    const { resolve } = resolver({
      'rdap.example-registry.com': ['93.184.215.1'],
      'rdap.evil.example': ['169.254.169.254'],
    });
    const { connect, contacted } = router({ '93.184.215.1': registry });
    const client = new RdapWhois({ ...FAST, connect, resolve, targets: { allowInsecure: true } });
    const error = await client
      .rdap('example.com', { server: 'http://rdap.example-registry.com/' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BlockedTargetError);
    expect(error).toMatchObject({ retryable: false, tries: 1 });
    expect(contacted).toEqual(['93.184.215.1']);
    // the request went to the address, still addressed to the name
    expect(registry.requests[0]?.headers.host).toBe('rdap.example-registry.com');
  });

  it('refuses a first server whose name resolves to a private address', async () => {
    const { resolve } = resolver({ 'rdap.example-registry.com': ['::ffff:10.0.0.5'] });
    const { connect, contacted } = router({});
    const client = new RdapWhois({ ...FAST, connect, resolve });
    await expect(
      client.rdap('example.com', { server: 'https://rdap.example-registry.com/' })
    ).rejects.toBeInstanceOf(BlockedTargetError);
    expect(contacted).toEqual([]);
  });

  const certificate = testCertificate();
  it.skipIf(!certificate)(
    'connects over HTTPS to the checked address, verifying the certificate for the name',
    async () => {
      const tls = certificate!;
      const registry = started(
        await startHttpServer((_, response) => {
          response.writeHead(200, { 'Content-Type': 'application/rdap+json' });
          response.end(JSON.stringify(DOMAIN));
        }, tls)
      );
      const { resolve } = resolver({ [tls.hostname]: ['93.184.215.1'] });
      const trusting = createConnect({ tls: { ca: tls.cert } });
      const contacted: string[] = [];
      const connect: Connect = (target, options) => {
        contacted.push(target.host);
        return trusting({ host: '127.0.0.1', port: registry.port }, options);
      };
      const client = new RdapWhois({ ...FAST, connect, resolve });
      const hops = await client.rdap('example.com', { server: `https://${tls.hostname}/` });
      expect(hops[0]).toMatchObject({ status: 'found', httpStatus: 200 });
      expect(contacted).toEqual(['93.184.215.1']);
      expect(registry.requests[0]?.headers.host).toBe(tls.hostname);
    }
  );
});
