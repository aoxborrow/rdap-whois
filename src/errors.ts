// Errors thrown by the library. Every one extends RdapWhoisError, so a single
// `instanceof RdapWhoisError` separates the library's failures from anything else, and
// `name` tells them apart. Where a server answered with a status of its own, that is
// carried as `status`.
//
// Not everything a call can reject with is one of these: an abort rejects with the signal's
// own reason (an `AbortError`, or a `TimeoutError` from `AbortSignal.timeout()`), and a
// mistake in the call itself, such as a malformed proxy URL or an unknown encoding, is a
// `TypeError` or `RangeError`.

import type { LookupAttempt } from './client';

export type Protocol = 'whois' | 'rdap';

// context common to every error
export interface ErrorDetails {
  // which protocol the failing request used
  protocol?: Protocol;
  // the server being queried, a hostname for WHOIS or a base URL for RDAP
  server?: string;
  // the query as it was sent
  query?: string;
  // the underlying error, when there is one
  cause?: unknown;
  // the failure came by way of a proxy: the proxy reported that it could not reach the
  // target, or the time ran out while it was opening the tunnel
  viaProxy?: boolean;
  // how many times the request was sent before this was thrown, when it was retried
  tries?: number;
  // whether sending the same request again could succeed, when it differs from the
  // class's own answer
  retryable?: boolean;
}

/**
 * the plain-object form of an error, used where an error is embedded in a result or an
 * event. It keeps everything the error says about where it happened
 */
export interface ErrorInfo {
  /** one of the library's error names, or the name of an error from outside the library */
  name: RdapWhoisErrorName | (string & {});
  message: string;
  retryable: boolean;
  protocol?: Protocol;
  server?: string;
  query?: string;
  /** the HTTP status the server answered with */
  status?: number;
  viaProxy?: boolean;
  /** how long the server asked us to wait, in milliseconds */
  retryAfter?: number;
  tries?: number;
}

/** the name of every error class the library throws, which is also the `name` of its errors */
export type RdapWhoisErrorName =
  | 'RdapWhoisError'
  | 'InvalidQueryError'
  | 'NoUsableAnswerError'
  | 'TimeoutError'
  | 'RateLimitError'
  | 'NoServerError'
  | 'ProxyError'
  | 'EmptyResponseError'
  | 'InvalidResponseError'
  | 'ServerError'
  | 'ConnectionError'
  | 'BlockedTargetError';

// marks the library's errors under a key every copy of the library shares (see below)
const BRAND = Symbol.for('@aoxborrow/rdap-whois/error');

export class RdapWhoisError extends Error {
  // A program can end up with two copies of the library's modules: loaded once as ES modules
  // and once as CommonJS, or from two installed versions. `instanceof` then still holds
  // across them: an error from either copy is an instance of the other copy's class of the
  // same name, and every one of them is an RdapWhoisError
  static [Symbol.hasInstance](value: unknown): boolean {
    if (Function.prototype[Symbol.hasInstance].call(this, value)) return true;
    if (typeof value !== 'object' || value === null || !(BRAND in value)) return false;
    return this.name === 'RdapWhoisError' || (value as { name?: unknown }).name === this.name;
  }

  override readonly name: RdapWhoisErrorName = 'RdapWhoisError';
  /** whether sending the same request again could succeed */
  readonly retryable: boolean;
  readonly protocol?: Protocol;
  readonly server?: string;
  readonly query?: string;
  /** how many times the request was sent before this was thrown, when it was retried */
  readonly tries?: number;
  /** whether the failure came by way of a proxy and not from the target directly */
  readonly viaProxy: boolean;
  // what the error was made from, so a copy with more context can be made of it
  readonly #details: ErrorDetails;

  constructor(message: string, details: ErrorDetails = {}) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.#details = details;
    this.retryable = details.retryable ?? this.defaultRetryable(details);
    this.protocol = details.protocol;
    this.server = details.server;
    this.query = details.query;
    this.tries = details.tries;
    this.viaProxy = details.viaProxy ?? false;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  // whether a failure of this kind could clear up by itself
  protected defaultRetryable(_details: ErrorDetails): boolean {
    return false;
  }

  /** the plain-object form, safe to store or send */
  toJSON(): ErrorInfo {
    const info: ErrorInfo = {
      name: this.name,
      message: this.message,
      retryable: this.retryable,
    };
    const extra = this as Partial<Record<'status' | 'retryAfter', number>>;
    if (this.protocol !== undefined) info.protocol = this.protocol;
    if (this.server !== undefined) info.server = this.server;
    if (this.query !== undefined) info.query = this.query;
    if (extra.status !== undefined) info.status = extra.status;
    if (this.viaProxy) info.viaProxy = true;
    if (extra.retryAfter !== undefined) info.retryAfter = extra.retryAfter;
    if (this.tries !== undefined) info.tries = this.tries;
    return info;
  }

  /**
   * the same error with more details: a new error of the same class, made through its
   * constructor, with the original's stack
   */
  withDetails(details: ErrorDetails): this {
    const Class = this.constructor as new (message: string, details: ErrorDetails) => this;
    const copy = new Class(this.message, { ...this.#details, ...details });
    if (this.stack !== undefined) copy.stack = this.stack;
    return copy;
  }
}

Object.defineProperty(RdapWhoisError.prototype, BRAND, { value: true });

/** the query is not a valid domain, IP address, AS number or handle */
export class InvalidQueryError extends RdapWhoisError {
  override readonly name = 'InvalidQueryError' as const;
}

export interface NoUsableAnswerDetails extends ErrorDetails {
  // every protocol lookup() tried, with every server's answer
  attempts?: LookupAttempt[];
}

/**
 * lookup() asked, servers answered, and none of the answers was usable, while no registry
 * said the name does not exist: it could not tell
 */
export class NoUsableAnswerError extends RdapWhoisError {
  override readonly name = 'NoUsableAnswerError' as const;
  /** every protocol lookup() tried, as LookupResult.attempts would have listed them */
  readonly attempts: LookupAttempt[];

  constructor(message: string, details: NoUsableAnswerDetails = {}) {
    super(message, details);
    this.attempts = details.attempts ?? [];
  }
}

/**
 * connecting or reading took longer than the timeout. A server that stayed silent that long
 * rarely answers the same request sent again, so it is not retried. A proxy that did not
 * open its tunnel in time is: a rotating proxy's next try goes out through another exit.
 * The wait for a free connection to a busy server is retried too, and says so in `retryable`
 */
export class TimeoutError extends RdapWhoisError {
  override readonly name = 'TimeoutError' as const;
  protected override defaultRetryable(details: ErrorDetails): boolean {
    return details.viaProxy === true;
  }
}

export interface RateLimitDetails extends ErrorDetails {
  // the throttle page or response body as the server sent it
  raw?: string;
  // how long the server asked us to wait, in milliseconds
  retryAfter?: number;
}

/** the server refused the request because of a rate limit */
export class RateLimitError extends RdapWhoisError {
  override readonly name = 'RateLimitError' as const;
  readonly raw?: string;
  readonly retryAfter?: number;

  constructor(message: string, details: RateLimitDetails = {}) {
    super(message, details);
    this.raw = details.raw;
    this.retryAfter = details.retryAfter;
  }

  protected override defaultRetryable(): boolean {
    return true;
  }
}

/** no WHOIS or RDAP server is known for the query */
export class NoServerError extends RdapWhoisError {
  override readonly name = 'NoServerError' as const;
}

/** the proxy refused the connection, rejected the credentials or could not reach the target */
export class ProxyError extends RdapWhoisError {
  override readonly name = 'ProxyError' as const;
  protected override defaultRetryable(): boolean {
    return true;
  }
}

/** the server closed the connection without sending anything */
export class EmptyResponseError extends RdapWhoisError {
  override readonly name = 'EmptyResponseError' as const;
  protected override defaultRetryable(): boolean {
    return true;
  }
}

export interface ResponseDetails extends ErrorDetails {
  // the HTTP status the server answered with, when there was one
  status?: number;
}

/** the response could not be used: not parseable, too large, or about a different object */
export class InvalidResponseError extends RdapWhoisError {
  override readonly name = 'InvalidResponseError' as const;
  readonly status?: number;

  constructor(message: string, details: ResponseDetails = {}) {
    super(message, details);
    this.status = details.status;
  }
}

export interface ServerErrorDetails extends ResponseDetails {
  // the error body the server sent, e.g. an RDAP error object
  body?: unknown;
}

/** the server answered with an error of its own. Retryable only for a 5xx */
export class ServerError extends RdapWhoisError {
  override readonly name = 'ServerError' as const;
  readonly status?: number;
  readonly body?: unknown;

  constructor(message: string, details: ServerErrorDetails = {}) {
    super(message, details);
    this.status = details.status;
    this.body = details.body;
  }

  protected override defaultRetryable(details: ServerErrorDetails): boolean {
    return details.status !== undefined && details.status >= 500;
  }
}

/**
 * the target policy refused a server: its name is not a public hostname, an IP literal or
 * an address it resolves to is not public, or the policy's own allow() said no. Thrown
 * before anything is sent to it, and never retried
 */
export class BlockedTargetError extends RdapWhoisError {
  override readonly name = 'BlockedTargetError' as const;
}

/** the connection was refused, reset, or closed before the response was complete */
export class ConnectionError extends RdapWhoisError {
  override readonly name = 'ConnectionError' as const;
  protected override defaultRetryable(): boolean {
    return true;
  }
}

// fill in what an error does not say about where it happened. The network layer throws
// without knowing which lookup it was part of; the client adds that on the way up. Details
// the error already has are kept
export function withErrorContext<T extends RdapWhoisError>(
  error: T,
  details: Pick<ErrorDetails, 'protocol' | 'server' | 'query'>
): T {
  return error.withDetails({
    protocol: error.protocol ?? details.protocol,
    server: error.server ?? details.server,
    query: error.query ?? details.query,
  });
}

// the plain-object form of anything thrown, for embedding in a result. An error from
// outside the library is reported as not retryable
export function toErrorInfo(error: unknown): ErrorInfo {
  if (error instanceof RdapWhoisError) {
    return error.toJSON();
  }
  if (error instanceof Error) {
    return { name: error.name, message: error.message, retryable: false };
  }
  return { name: 'Error', message: String(error), retryable: false };
}
