import { describe, expect, it } from 'vitest';
import {
  ConnectionError,
  EmptyResponseError,
  InvalidQueryError,
  InvalidResponseError,
  NoServerError,
  NoUsableAnswerError,
  ProxyError,
  RateLimitError,
  ServerError,
  TimeoutError,
  RdapWhoisError,
  toErrorInfo,
} from '../src/errors';

// the public contract: each class's name and whether the library retries it
const TABLE: [new (message: string) => RdapWhoisError, string, boolean][] = [
  [InvalidQueryError, 'InvalidQueryError', false],
  [NoUsableAnswerError, 'NoUsableAnswerError', false],
  [TimeoutError, 'TimeoutError', false],
  [RateLimitError, 'RateLimitError', true],
  [NoServerError, 'NoServerError', false],
  [ProxyError, 'ProxyError', true],
  [EmptyResponseError, 'EmptyResponseError', true],
  [InvalidResponseError, 'InvalidResponseError', false],
  [ConnectionError, 'ConnectionError', true],
];

describe('errors', () => {
  it.each(TABLE)('%o has the documented name and retryable', (Class, name, retry) => {
    const error = new Class('boom');
    expect(error).toBeInstanceOf(RdapWhoisError);
    expect(error).toBeInstanceOf(Class);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe(name);
    expect(error).not.toHaveProperty('code');
    expect(error.retryable).toBe(retry);
    expect(error.message).toBe('boom');
  });

  it('carries the request context and the cause', () => {
    const cause = new Error('socket hang up');
    const error = new ConnectionError('connection closed', {
      protocol: 'whois',
      server: 'whois.example',
      query: 'example.com',
      cause,
    });
    expect(error.protocol).toBe('whois');
    expect(error.server).toBe('whois.example');
    expect(error.query).toBe('example.com');
    expect(error.cause).toBe(cause);
  });

  it('retries a server error only when the status is 5xx', () => {
    expect(new ServerError('unavailable', { status: 503 }).retryable).toBe(true);
    expect(new ServerError('bad request', { status: 400 }).retryable).toBe(false);
    expect(new ServerError('no status').retryable).toBe(false);
  });

  it('keeps the throttle page and the wait on a rate limit error', () => {
    const error = new RateLimitError('rate limited', {
      raw: 'Query rate exceeded',
      retryAfter: 5000,
    });
    expect(error.raw).toBe('Query rate exceeded');
    expect(error.retryAfter).toBe(5000);
  });

  it('retries a timeout only when a proxy did not open its tunnel in time', () => {
    expect(new TimeoutError('silent server').retryable).toBe(false);
    expect(new TimeoutError('no tunnel', { viaProxy: true }).retryable).toBe(true);
  });

  it('serialises to the plain form used inside results, with where it happened', () => {
    const info = {
      name: 'TimeoutError',
      message: 'timed out',
      retryable: false,
      protocol: 'whois',
      server: 'whois.example',
      query: 'example.com',
      tries: 3,
    };
    const error = new TimeoutError('timed out', {
      protocol: 'whois',
      server: 'whois.example',
      query: 'example.com',
      tries: 3,
    });
    expect(error.toJSON()).toEqual(info);
    expect(JSON.parse(JSON.stringify(error))).toEqual(info);
    expect(toErrorInfo(error)).toEqual(info);
  });

  it('serialises the status, the wait and a proxy failure', () => {
    expect(new ServerError('unavailable', { status: 503 }).toJSON()).toEqual({
      name: 'ServerError',
      message: 'unavailable',
      retryable: true,
      status: 503,
    });
    expect(new RateLimitError('slow down', { retryAfter: 5000, raw: 'page' }).toJSON()).toEqual({
      name: 'RateLimitError',
      message: 'slow down',
      retryable: true,
      retryAfter: 5000,
    });
    expect(new ConnectionError('refused', { viaProxy: true }).toJSON()).toMatchObject({
      viaProxy: true,
    });
  });

  it('takes tries and retryable through the constructor', () => {
    const error = new ProxyError('no tunnel', { retryable: false, tries: 2 });
    expect(error.retryable).toBe(false);
    expect(error.tries).toBe(2);
  });

  it('copies itself with more details, keeping its class, fields and stack', () => {
    const cause = new Error('reset');
    const error = new RateLimitError('slow down', { raw: 'page', retryAfter: 1000, cause });
    const copy = error.withDetails({ tries: 3, server: 'whois.example' });
    expect(copy).not.toBe(error);
    expect(copy).toBeInstanceOf(RateLimitError);
    expect(copy).toMatchObject({ raw: 'page', retryAfter: 1000, tries: 3 });
    expect(copy.server).toBe('whois.example');
    expect(copy.cause).toBe(cause);
    expect(copy.stack).toBe(error.stack);
    expect(error.tries).toBeUndefined();
  });

  it('carries the lookup attempts on NoUsableAnswerError', () => {
    const attempts = [{ protocol: 'rdap' as const, hops: [] }];
    const error = new NoUsableAnswerError('nothing usable', { attempts });
    expect(error.attempts).toBe(attempts);
    expect(new NoUsableAnswerError('nothing').attempts).toEqual([]);
  });

  it('reports an error from outside the library as not retryable', () => {
    expect(toErrorInfo(new TypeError('nope'))).toEqual({
      name: 'TypeError',
      message: 'nope',
      retryable: false,
    });
    expect(toErrorInfo('just a string')).toEqual({
      name: 'Error',
      message: 'just a string',
      retryable: false,
    });
  });
});

describe('two copies of the library in one program', () => {
  it('keeps instanceof across them, by class name', async () => {
    // a second instance of the module, as a program that loads the library both as ES
    // modules and as CommonJS ends up with
    const copy = new URL('../src/errors.ts?copy', import.meta.url).href;
    const other = (await import(/* @vite-ignore */ copy)) as typeof import('../src/errors');
    expect(other.TimeoutError).not.toBe(TimeoutError);

    const theirs = new other.TimeoutError('t');
    expect(theirs).toBeInstanceOf(TimeoutError);
    expect(theirs).toBeInstanceOf(RdapWhoisError);
    expect(theirs).not.toBeInstanceOf(ConnectionError);
    expect(new ConnectionError('c')).toBeInstanceOf(other.RdapWhoisError);
    expect(new Error('plain')).not.toBeInstanceOf(other.RdapWhoisError);
    expect(toErrorInfo(theirs)).toMatchObject({ name: 'TimeoutError', retryable: false });
  });

  it('relies on each class being named as its errors are', () => {
    for (const [Class, name] of [...TABLE, [ServerError, 'ServerError'] as const]) {
      expect(Class.name).toBe(name);
    }
  });
});
