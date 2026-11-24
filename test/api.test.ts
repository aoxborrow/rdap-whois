// the public surface: options a caller leaves undefined, the numbers it may give, the
// User-Agent, the data and package versions, and the types callers narrow on.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, expectTypeOf, it } from 'vitest';
import dnsBootstrap from '../data/rdap/dns.json';
import knownLimits from '../data/limits.json';
import { RdapWhois, type LookupAttempt, type LookupManyItem } from '../src/client';
import { DEFAULT_USER_AGENT } from '../src/core';
import { DATA_VERSION } from '../src/data-version';
import * as errors from '../src/errors';
import type { ErrorInfo, RdapWhoisErrorName } from '../src/errors';
import type { RdapHop } from '../src/rdap/client';
import type { RdapResponse } from '../src/rdap/types';
import type { FetchLike } from '../src/rdap/request';
import * as utils from '../src/utils';
import * as whois from '../src/whois/index';
import type { WhoisHop } from '../src/whois/client';
import type { WhoisDataType } from '../src/whois/data-types';
import { TLD_TABLE_UPDATED } from '../src/whois/generated/tlds-updated';
import { VERSION } from '../src/version';

const DOMAIN = {
  rdapConformance: ['rdap_level_0'],
  objectClassName: 'domain',
  ldhName: 'EXAMPLE.COM',
  events: [{ eventAction: 'registration', eventDate: '1995-08-14T04:00:00Z' }],
};

// an RDAP fetch that answers every request with the domain after 20 ms, keeping each
// request's headers
function recordingFetch() {
  const headers: Record<string, string>[] = [];
  const fetch: FetchLike = async (url, init) => {
    headers.push(init.headers);
    await new Promise(resolve => setTimeout(resolve, 20));
    return new Response(JSON.stringify(DOMAIN), { status: 200 });
  };
  return { fetch, headers };
}

describe('options a caller sets to undefined', () => {
  it('take their defaults, in the constructor and in each call', async () => {
    const { fetch } = recordingFetch();
    // an undefined timeout was a 1 ms timer, which failed every request
    const client = new RdapWhois({ timeout: undefined, retries: undefined, fetch });
    const hops = await client.rdap('example.com', { timeout: undefined, validate: undefined });
    expect(hops[0]?.status).toBe('found');
  });

  it('leave retries and validation on', async () => {
    let calls = 0;
    const fetch: FetchLike = () =>
      ++calls === 1
        ? Promise.resolve(new Response('', { status: 503 }))
        : Promise.resolve(new Response(JSON.stringify(DOMAIN), { status: 200 }));
    const client = new RdapWhois({ fetch, backoff: 1 });
    const hops = await client.rdap('example.com', { retries: undefined });
    expect(hops[0]).toMatchObject({ status: 'found', tries: 2 });
    // validation still refuses an answer about some other domain
    await expect(client.rdap('example.org', { validate: undefined })).rejects.toBeInstanceOf(
      errors.InvalidResponseError
    );
  });
});

describe('numeric options', () => {
  it('are refused with a RangeError when they cannot be used', () => {
    expect(() => new RdapWhois({ timeout: 0 })).toThrow(RangeError);
    expect(() => new RdapWhois({ retries: 1.5 })).toThrow(/retries must be a whole number/);
    expect(() => new RdapWhois({ concurrency: 0 })).toThrow(RangeError);
    expect(() => new RdapWhois({ maxResponseBytes: Number.NaN })).toThrow(RangeError);
    expect(() => new RdapWhois({ timeout: Infinity })).toThrow(RangeError);
  });

  it('allow no total limit', () => {
    expect(() => new RdapWhois({ totalTimeout: Infinity })).not.toThrow();
  });

  it('are checked on every call, not only when the client is made', async () => {
    const client = new RdapWhois();
    await expect(client.rdap('example.com', { timeout: -1 })).rejects.toBeInstanceOf(RangeError);
    await expect(client.whois('example.com', { port: 0 })).rejects.toBeInstanceOf(RangeError);
    await expect(client.lookup('example.com', { totalTimeout: 0 })).rejects.toBeInstanceOf(
      RangeError
    );
    await expect(client.lookupAll(['example.com'], { batchConcurrency: 0 })).rejects.toBeInstanceOf(
      RangeError
    );
  });
});

describe('the User-Agent', () => {
  afterEach(() => {
    delete (globalThis as { document?: unknown }).document;
    delete (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope;
  });

  it('names the library, its version and where to find it', async () => {
    const { fetch, headers } = recordingFetch();
    await new RdapWhois({ fetch }).rdap('example.com');
    expect(DEFAULT_USER_AGENT).toBe(
      `rdap-whois/${VERSION} (+https://github.com/aoxborrow/rdap-whois)`
    );
    expect(headers[0]?.['User-Agent']).toBe(DEFAULT_USER_AGENT);
  });

  it('is the caller’s when it gives one', async () => {
    const { fetch, headers } = recordingFetch();
    await new RdapWhois({ fetch, userAgent: 'my-app/1.0' }).rdap('example.com');
    expect(headers[0]?.['User-Agent']).toBe('my-app/1.0');
  });

  it('is not sent from a browser, where it would make the request need a preflight', async () => {
    (globalThis as { document?: unknown }).document = {};
    const { fetch, headers } = recordingFetch();
    await new RdapWhois({ fetch }).rdap('example.com');
    expect(headers[0]).not.toHaveProperty('User-Agent');
  });

  it('is not sent from a browser worker, module workers included', async () => {
    (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope = class {};
    const { fetch, headers } = recordingFetch();
    await new RdapWhois({ fetch }).rdap('example.com');
    expect(headers[0]).not.toHaveProperty('User-Agent');
  });
});

describe('versions', () => {
  it('VERSION is the package version', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    ) as { version: string };
    expect(VERSION).toBe(manifest.version);
  });

  it('DATA_VERSION dates the routing data and the limits', () => {
    expect(DATA_VERSION).toEqual({
      rdapBootstrap: dnsBootstrap.publication.slice(0, 10),
      whoisTables: TLD_TABLE_UPDATED,
      limits: knownLimits.updated,
    });
    for (const date of Object.values(DATA_VERSION)) expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('the error classes', () => {
  const classes = Object.values(errors).filter(
    (value): value is typeof errors.RdapWhoisError =>
      typeof value === 'function' && value.prototype instanceof Error
  );

  it('are each named for their class, and the name is one RdapWhoisErrorName lists', () => {
    const names: Record<RdapWhoisErrorName, true> = {
      RdapWhoisError: true,
      InvalidQueryError: true,
      NoUsableAnswerError: true,
      TimeoutError: true,
      RateLimitError: true,
      NoServerError: true,
      ProxyError: true,
      EmptyResponseError: true,
      InvalidResponseError: true,
      ServerError: true,
      ConnectionError: true,
    };
    expect(classes.map(Class => new Class('x').name).sort()).toEqual(Object.keys(names).sort());
  });

  it('have literal names, so a switch on name narrows', () => {
    expectTypeOf(new errors.TimeoutError('x').name).toEqualTypeOf<'TimeoutError'>();
    expectTypeOf<ErrorInfo['name']>().toExtend<string>();
    expectTypeOf<'TimeoutError'>().toExtend<ErrorInfo['name']>();
  });
});

describe('the result types', () => {
  it('pair a hop’s status with what it holds', () => {
    expectTypeOf<Extract<RdapHop, { status: 'found' }>['data']>().toEqualTypeOf<RdapResponse>();
    expectTypeOf<Extract<RdapHop, { status: 'error' }>['error']>().toEqualTypeOf<ErrorInfo>();
    expectTypeOf<
      Extract<WhoisHop, { status: 'found' | 'reserved' }>['data']
    >().toEqualTypeOf<WhoisDataType>();
    expectTypeOf<
      Extract<WhoisHop, { status: 'found' | 'reserved' }>['raw']
    >().toEqualTypeOf<string>();
    expectTypeOf<Extract<WhoisHop, { status: 'error' }>['error']>().toEqualTypeOf<ErrorInfo>();
  });

  it('tell a batch item’s result from its error by ok', () => {
    expectTypeOf<Extract<LookupManyItem, { ok: true }>>().toHaveProperty('result');
    expectTypeOf<Extract<LookupManyItem, { ok: false }>>().toHaveProperty('error');
    expectTypeOf<Extract<LookupAttempt, { protocol: 'whois' }>['hops']>().toEqualTypeOf<
      WhoisHop[]
    >();
  });
});

describe('/utils', () => {
  it('leaves out the exports trimmed for 0.1, and has no duplicates', () => {
    for (const name of [
      'DOMAIN_SOURCE_TYPES',
      'RDAP_SOURCE_TYPE',
      'WHOIS_SOURCE_TYPE',
      'getAllCountryCodes',
      'RDAP_OBJECT_CLASSES',
      'RDAP_ROLE_DESCRIPTIONS',
      'transformRdapDomainData',
      'transformWhoisDomainData',
    ]) {
      expect(utils, name).not.toHaveProperty(name);
    }
    expect(utils.RDAP_REGIONAL_REGISTRIES.ARIN).toBe('https://rdap.arin.net/registry/');
    expect(utils.WHOIS_REGIONAL_REGISTRIES.RIPE).toBe('whois.ripe.net');
    expect(typeof utils.cleanStatus).toBe('function');
    expect(typeof utils.cleanNameserver).toBe('function');
  });

  it('leaves the record transforms to /whois, among its parts that may change', () => {
    expect(typeof whois.transformRdapDomainData).toBe('function');
    expect(typeof whois.transformWhoisDomainData).toBe('function');
  });
});
