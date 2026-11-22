// What the WHOIS client, the RDAP client and the combined client share: the options, the
// events, the per-server limiter, the retry loop, a call's total time and the cache. Nothing
// here knows either protocol's wire format.
import type { QueryType } from './common/constants';
import {
  RateLimitError,
  RdapWhoisError,
  toErrorInfo,
  type ErrorInfo,
  type Protocol,
} from './errors';
import { abortable, abortReason, deadline, sleep } from './net/deadline';
import { DEFAULT_SERVER_LIMIT, ServerLimiter, type ServerLimit } from './net/limiter';
import type { TargetPolicy } from './net/targets';
import { VERSION } from './version';
import type { Connect, ProxyOption } from './net/types';
import type { FetchLike } from './rdap/request';
import type { RdapHop } from './rdap/client';
import type { WhoisHop } from './whois/client';

// ---------------------------------------------------------------------------------------
// options
// ---------------------------------------------------------------------------------------

/**
 * what a caller passes to a client: every option is optional, and one left out takes its
 * default
 */
export interface RdapWhoisOptions {
  /**
   * how long one network exchange may take, in milliseconds. Default 10 000. Through a
   * proxy with a connectTimeout, a WHOIS hop may take up to that plus this
   */
  timeout?: number;
  /**
   * how many times to send a request again after a failure that could be temporary.
   * Default 2; 0 turns retries off
   */
  retries?: number;
  /** the first retry delay in milliseconds; each later one doubles. Default 250 */
  backoff?: number;
  /**
   * how long one call (whois(), rdap() or lookup()) may take in all, in milliseconds,
   * retries, referrals and waits included. Default 30 000. A wait that would not fit in
   * the time left (a backoff, a server's Retry-After, a throttled server's queue) is not
   * waited out: the call fails at once with the error behind it. Infinity for no limit
   */
  totalTimeout?: number;
  /**
   * how many referrals to follow, e.g. from a registry to the registrar. Default 1; 0 turns
   * it off
   */
  followReferrals?: number;
  /**
   * how many HTTP redirects an RDAP request may follow. Each one is checked against the
   * target policy first. Default 5; 0 turns it off
   */
  followRedirects?: number;
  /** the largest response to accept, in bytes. Default 1 000 000 */
  maxResponseBytes?: number;
  /**
   * check that an RDAP response is about the domain asked for, and that its registration
   * date is believable. Default true
   */
  validate?: boolean;
  /**
   * the User-Agent header for RDAP requests. Default `rdap-whois/<version> (+<repository>)`,
   * except in a browser, where none is sent: it is not a CORS-safelisted header, so sending
   * one would make the browser ask the server first, which many RDAP servers do not answer
   */
  userAgent?: string;
  /**
   * requests in flight to one server at a time. Default 2. A server whose registry
   * publishes a limit gets that instead (KNOWN_SERVER_LIMITS), and one in `serverLimits`
   * its own
   */
  concurrency?: number;
  /**
   * the shortest time between two requests to one server starting, in milliseconds.
   * Default 250
   */
  minInterval?: number;
  /** limits by server hostname, which win over the published ones and the two above */
  serverLimits?: Record<string, ServerLimit>;
  /** lookupMany() and lookupAll(): how many lookups are in flight at once. Default 8 */
  batchConcurrency?: number;
  /**
   * replaces the RDAP transport: every RDAP request is made with this, and `proxy` is not
   * applied to it
   */
  fetch?: FetchLike;
  /** which hosts may be contacted */
  targets?: TargetPolicy;
  /** a proxy URL for both protocols, or { whois, rdap } with one for each */
  proxy?: ProxyOption;
  /** abort every request made with these options */
  signal?: AbortSignal;
  /** replaces the runtime's TCP connect */
  connect?: Connect;
  /** called for every network exchange and every decision to make another one */
  onEvent?: (event: ClientEvent) => void;
  /** keeps each protocol's answers, so a query asked again is answered without a request */
  cache?: HopCache;
}

// the options that have a default
type DefaultedOption =
  | 'timeout'
  | 'retries'
  | 'backoff'
  | 'totalTimeout'
  | 'followReferrals'
  | 'followRedirects'
  | 'maxResponseBytes'
  | 'validate'
  | 'concurrency'
  | 'minInterval'
  | 'batchConcurrency';

const DEFAULT_OPTIONS: Readonly<Required<Pick<RdapWhoisOptions, DefaultedOption>>> = Object.freeze({
  timeout: 10_000,
  retries: 2,
  backoff: 250,
  totalTimeout: 30_000,
  followReferrals: 1,
  followRedirects: 5,
  maxResponseBytes: 1_000_000,
  validate: true,
  concurrency: DEFAULT_SERVER_LIMIT.concurrency,
  minInterval: DEFAULT_SERVER_LIMIT.minInterval,
  batchConcurrency: 8,
});

// the User-Agent sent when the caller gives none, outside a browser
export const DEFAULT_USER_AGENT = `rdap-whois/${VERSION} (+https://github.com/aoxborrow/rdap-whois)`;

// whether this is a browser page or any kind of browser worker. Workers runs as a worker too,
// and is told apart by its navigator.userAgent
const isBrowser = (): boolean =>
  'document' in globalThis || ('WorkerGlobalScope' in globalThis && !isWorkers());

// the options a caller gave, without the ones set to undefined, which take their default as
// if they had been left out. Only for what a caller passes: the library itself sets an option
// to undefined to clear it, as for a referral's port
export function given<T extends object>(options: T | undefined): Partial<T> {
  if (!options) return {};
  return Object.fromEntries(
    Object.entries(options).filter(([, value]) => value !== undefined)
  ) as Partial<T>;
}

// the numeric options and the values each may take: at least `min`, or above it with
// `above`; a whole number with `integer`; and Infinity only with `infinite`
const NUMBER_RULES: Record<
  string,
  { min: number; integer?: boolean; infinite?: boolean; above?: boolean }
> = {
  timeout: { min: 0, above: true },
  retries: { min: 0, integer: true },
  backoff: { min: 0 },
  totalTimeout: { min: 0, above: true, infinite: true },
  followReferrals: { min: 0, integer: true },
  followRedirects: { min: 0, integer: true },
  maxResponseBytes: { min: 1, integer: true },
  concurrency: { min: 1, integer: true },
  minInterval: { min: 0 },
  batchConcurrency: { min: 1, integer: true },
  port: { min: 1, integer: true },
};

// check the numeric options of a merged set, throwing a RangeError for the first that is not
// a usable value
export function checkOptions<T extends object>(options: T): T {
  for (const [name, rule] of Object.entries(NUMBER_RULES)) {
    const value = (options as Record<string, unknown>)[name];
    if (value === undefined) continue;
    const ok =
      typeof value === 'number' &&
      (rule.above ? value > rule.min : value >= rule.min) &&
      (rule.integer
        ? Number.isInteger(value)
        : Number.isFinite(value) || (rule.infinite === true && value === Infinity));
    if (!ok) {
      const kind = rule.integer ? 'a whole number' : 'a number';
      const bound = rule.above ? `above ${rule.min}` : `of at least ${rule.min}`;
      const shown = typeof value === 'number' ? value : JSON.stringify(value);
      throw new RangeError(`${name} must be ${kind} ${bound}, not ${shown}`);
    }
  }
  return options;
}

/**
 * what can be changed for one call. The per-server limits belong to the client, so they are
 * not among them
 */
export type CallOptions = Omit<RdapWhoisOptions, 'concurrency' | 'minInterval' | 'serverLimits'>;

// ---------------------------------------------------------------------------------------
// cache
// ---------------------------------------------------------------------------------------

/**
 * what one protocol lookup is cached under: the server asked first, as the routing data or
 * the `server` option named it, and the query as it was normalized
 */
export interface CacheKey {
  protocol: Protocol;
  /** a hostname for WHOIS, a base URL for RDAP */
  server: string;
  query: string;
  queryType: QueryType;
  /**
   * the encoding a whois() call asked the first server's response to be read in, when it
   * set one, since that changes the answer
   */
  encoding?: string;
}

/** the hops one protocol lookup returned, the first server's and each referral's */
export type CachedHops = WhoisHop[] | RdapHop[];

/**
 * Where whois(), rdap() and lookup() keep each protocol's answers. `get` is asked before
 * the first request of a protocol lookup: hops it returns are the answer, and no request
 * is made; null or undefined is a miss. After a lookup that made its requests, `set` is
 * given the hops with a suggested lifetime in milliseconds (an hour for an answer, five
 * minutes for "no such object", one minute when a referral failed). A lookup whose first
 * server failed is thrown, not cached. The library does not catch what `get` or `set`
 * throws: it fails the call as a failed request would
 */
export interface HopCache {
  get(key: CacheKey): CachedHops | null | undefined | Promise<CachedHops | null | undefined>;
  set(key: CacheKey, hops: CachedHops, ttl: number): void | Promise<void>;
}

// the lifetime suggested to `set`, by what the hops amount to
const CACHE_TTL = { answer: 3_600_000, notFound: 300_000, failedReferral: 60_000 };

function cacheTtl(hops: CachedHops): number {
  if (hops.some(hop => hop.status === 'error')) return CACHE_TTL.failedReferral;
  if (hops[0]?.status === 'notfound') return CACHE_TTL.notFound;
  return CACHE_TTL.answer;
}

// ---------------------------------------------------------------------------------------
// results and events
// ---------------------------------------------------------------------------------------

/** what a server's answer amounted to */
export type HopStatus = 'found' | 'notfound' | 'reserved' | 'error';

/** one network exchange, reported when it ends whether it worked or not */
export interface RequestEvent {
  type: 'request';
  protocol: Protocol;
  server: string;
  /** the query line for WHOIS, the URL for RDAP */
  query: string;
  /** 1 for the first try */
  attempt: number;
  elapsed: number;
  /** bytes of response received */
  bytes: number;
  proxied: boolean;
  /** the HTTP status, for RDAP */
  status?: number;
  error?: ErrorInfo;
}

/** the request is about to be sent again */
export interface RetryEvent {
  type: 'retry';
  protocol: Protocol;
  server: string;
  /** the attempt that failed */
  attempt: number;
  /** how long until the next one, in milliseconds */
  delay: number;
  error: ErrorInfo;
}

/** another server is about to be asked because a response pointed at it */
export interface ReferralEvent {
  type: 'referral';
  protocol: Protocol;
  from: string;
  to: string;
}

/** an RDAP server answered with a redirect, which is about to be followed */
export interface RedirectEvent {
  type: 'redirect';
  protocol: 'rdap';
  from: string;
  to: string;
  status: number;
}

/** lookup() is moving on from RDAP to WHOIS */
export interface FallbackEvent {
  type: 'fallback';
  from: 'rdap';
  to: 'whois';
  /** RDAP failed, said the name does not exist, or answered with too little to use */
  reason: 'error' | 'notfound' | 'insufficient';
}

/**
 * a server's answer could not be made into a record and was passed over, as if it had not
 * answered. `error` is what the transform threw
 */
export interface TransformErrorEvent {
  type: 'transform-error';
  protocol: Protocol;
  server: string;
  error: ErrorInfo;
}

export type ClientEvent =
  RequestEvent | RetryEvent | ReferralEvent | RedirectEvent | FallbackEvent | TransformErrorEvent;

// ---------------------------------------------------------------------------------------
// the shared engine
// ---------------------------------------------------------------------------------------

// every setting, with the defaults filled in. The clients work with this; a caller never
// writes one
export type ResolvedOptions = RdapWhoisOptions & Required<Pick<RdapWhoisOptions, DefaultedOption>>;

// what one call carries down to every request it makes: when its time runs out, and a
// signal that aborts then or when the caller's own signal does
export interface CallRun {
  endsAt: number;
  signal: AbortSignal;
}

// the settings of a call that is under way
export type Running<O extends ResolvedOptions = ResolvedOptions> = O & { run: CallRun };

// the longest timer the runtime keeps; a longer totalTimeout is no limit
const MAX_TIMER = 2_147_483_647;

// whether this is a Cloudflare Worker, which says so in navigator.userAgent. It picks the TCP
// transport when no `connect` is given, so `connect` is how a caller overrides it
export const isWorkers = (): boolean =>
  typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers';

// run a task in a host's place in the limiter, pausing that host when it throttles. The task
// gets what is left of the call's timeout once the place is its own
export type Limited = <R>(host: string, task: (timeout: number) => Promise<R>) => Promise<R>;

// the transport for the runtime this is running on, loaded the first time it is needed so a
// consumer that never opens a socket never loads one
let runtimeConnect: Promise<Connect> | undefined;
export function defaultConnect(): Promise<Connect> {
  runtimeConnect ??= (
    isWorkers() ? import('./transports/cloudflare') : import('./transports/node')
  ).then(transport => transport.connect);
  return runtimeConnect;
}

// The state the clients share: the resolved options, one limiter for every server, and the
// machinery every request goes through. A combined client and the protocol clients it uses
// share one, so a server's limit holds across all of them
export class Core {
  readonly options: ResolvedOptions;
  readonly limiter: ServerLimiter;

  constructor(options: RdapWhoisOptions = {}) {
    this.options = checkOptions({
      ...DEFAULT_OPTIONS,
      ...(isBrowser() ? {} : { userAgent: DEFAULT_USER_AGENT }),
      ...given(options),
    });
    this.limiter = new ServerLimiter(this.options);
  }

  // the client's options with what a caller gave for one call on top, checked
  merge<O extends object>(callOptions: O | undefined): ResolvedOptions & O {
    return checkOptions({ ...this.options, ...given(callOptions) }) as ResolvedOptions & O;
  }

  emit(options: ResolvedOptions, event: ClientEvent): void {
    try {
      options.onEvent?.(event);
    } catch {
      // a listener that throws must not break the lookup it is watching, so what it throws
      // is dropped
    }
  }

  // run one request with retries. Each try goes through the server's limiter. A request
  // that may go on to other hosts (an RDAP redirect) passes `eachHost` and takes each
  // host's place itself, through the `limited` it is given, one host at a time. A
  // `referral` (the registrar's server) is optional to the lookup, so a proxy that could not
  // open its tunnel to it is not tried again: the registry's answer already stands, and a
  // tunnel that fails often fails only at its timeout, so a second one would double the
  // time it takes to report the referral failed. Failures that come back fast (a refused
  // connection, a throttle, a 5xx) are still retried, and the registry's own hop keeps the
  // tunnel retry
  async withRetries<T>(
    protocol: Protocol,
    server: string,
    options: Running,
    request: (attempt: number, limited: Limited, timeout: number) => Promise<T>,
    { eachHost = false, referral = false }: { eachHost?: boolean; referral?: boolean } = {}
  ): Promise<{ value: T; tries: number }> {
    const { run } = options;
    for (let attempt = 1; ; attempt++) {
      // exponential backoff with jitter, so a batch does not retry in step
      const exponential = options.backoff * 2 ** (attempt - 1);
      const backoff = Math.round(exponential * (0.5 + Math.random() / 2));
      // how long to wait before sending the request again after this error: a throttle's
      // Retry-After when it gave one, else the backoff
      const delayAfter = (error: unknown) =>
        error instanceof RateLimitError ? (error.retryAfter ?? backoff) : backoff;
      // whether this error is answered with another try: a failure that could clear up,
      // with tries left, and a wait for it that fits in the call's time left
      const willRetry = (error: unknown) =>
        error instanceof RdapWhoisError &&
        error.retryable &&
        !(referral && error.viaProxy) &&
        attempt <= options.retries &&
        !run.signal.aborted &&
        Date.now() + delayAfter(error) < run.endsAt;
      const limited: Limited = async (host, task) => {
        // The time spent waiting for a place counts toward the timeout: the deadline starts
        // when the call is made, not when a place opens, and a call still waiting at its
        // deadline is dropped without running. One slow or throttled server then cannot
        // hold another caller's lookup past that caller's own timeout
        const called = Date.now();
        // the call's own end is left to its signal, which aborts with the totalTimeout
        // error. Clamping this timer to it too would race the two, and the caller would get
        // whichever fired first
        const latest = called + options.timeout;
        const queued = deadline(
          Math.max(1, latest - called),
          `${host} had no free connection within ${options.timeout} ms`,
          run.signal,
          // the server was busy, not silent: another try may find a free connection
          { retryable: true }
        );
        try {
          return await this.limiter.run(
            host,
            async () => {
              queued.clear();
              const timeout = Math.max(1, latest - Date.now());
              try {
                return await task(timeout);
              } catch (error) {
                // a throttle is about the server, not this request. When this request will
                // be sent again, hold back the server's whole queue before giving up its
                // place in it, so neither the retry nor the next one waiting goes straight
                // out to a server that has just said stop. A request waiting there whose
                // time would run out first fails at once with this throttle. A request that
                // will not be sent again leaves the queue alone: pausing it would only hold
                // back other callers' lookups
                if (error instanceof RateLimitError && willRetry(error)) {
                  this.limiter.pause(host, delayAfter(error), error);
                }
                throw error;
              }
            },
            queued.signal,
            // a request still waiting when its own time or the call's would run out
            Math.min(latest, run.endsAt)
          );
        } finally {
          queued.clear();
        }
      };
      try {
        const value = eachHost
          ? await request(attempt, limited, options.timeout)
          : await limited(server, timeout => request(attempt, limited, timeout));
        return { value, tries: attempt };
      } catch (error) {
        // a wait that would not fit in the call's time left is not waited out: the error
        // behind it is the answer, at once
        if (!willRetry(error)) {
          throw error instanceof RdapWhoisError ? error.withDetails({ tries: attempt }) : error;
        }

        const delay = delayAfter(error);
        this.emit(options, {
          type: 'retry',
          protocol,
          server,
          attempt,
          delay,
          error: toErrorInfo(error),
        });
        // The retry waits out the whole delay itself, a throttle's Retry-After included. The
        // pause on the throttled host's queue is for the other requests waiting there, and
        // is the same length. This also covers a throttle from a host a redirect led to,
        // where the retry goes back to `server` first
        await sleep(delay, run.signal);
      }
    }
  }

  // Run a call with its total time: a signal that aborts with a TimeoutError when
  // totalTimeout runs out, or with the caller's reason when the caller's signal aborts. A
  // call made inside another (lookup()'s protocol lookups) shares the outer call's time
  async inRun<O extends ResolvedOptions, R>(
    options: O & { run?: CallRun },
    task: (options: Running<O>) => Promise<R>
  ): Promise<R> {
    if (options.run) return task(options as Running<O>);
    const { totalTimeout } = options;
    if (!(Number.isFinite(totalTimeout) && totalTimeout <= MAX_TIMER)) {
      // no limit: the signal is the caller's own
      const signal = options.signal ?? new AbortController().signal;
      return task({ ...options, run: { endsAt: Infinity, signal } });
    }
    const total = deadline(
      Math.max(0, totalTimeout),
      `The call took longer than its totalTimeout of ${totalTimeout} ms`,
      options.signal
    );
    try {
      return await task({
        ...options,
        run: { endsAt: Date.now() + totalTimeout, signal: total.signal },
      });
    } finally {
      total.clear();
    }
  }

  // one protocol lookup through the cache, when there is one: a hit is the answer, and a
  // lookup that made its requests is stored. Waiting on the cache counts toward the call's
  // time, and stops when the call is aborted, as a request would
  async cached<H extends CachedHops>(
    key: CacheKey,
    options: ResolvedOptions & { run?: CallRun },
    task: () => Promise<H>
  ): Promise<H> {
    const cache = options.cache;
    if (!cache) return task();
    const signal = options.run?.signal ?? options.signal;
    if (signal?.aborted) throw abortReason(signal);
    const hit = await abortable(Promise.resolve(cache.get(key)), signal);
    if (hit) return hit as H;
    const hops = await task();
    // the answer is in hand: a store that fails is the caller's to hear about, but one still
    // running when the call's time runs out or the call is aborted does not cost the answer
    const stored = Promise.resolve(cache.set(key, hops, cacheTtl(hops)));
    try {
      await abortable(stored, signal);
    } catch (error) {
      if (!signal?.aborted) throw error;
    }
    return hops;
  }
}
