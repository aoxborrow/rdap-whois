// The WHOIS client: asks the server the routing data names (or the one given), follows the
// referral to the registrar's server, and returns every server's answer with the fields
// parsed from it. It shares the retry loop, limiter and cache with the RDAP client through
// Core, and imports nothing from the RDAP side.
import { isTld, normalizeServer } from '../common/utils';
import {
  IANA_SERVER_TYPE,
  REGIONAL_SERVER_TYPE,
  REGISTRY_SERVER_TYPE,
  type QueryType,
} from '../common/constants';
import {
  EmptyResponseError,
  InvalidQueryError,
  InvalidResponseError,
  NoServerError,
  RateLimitError,
  ServerError,
  RdapWhoisError,
  toErrorInfo,
  withErrorContext,
  type ErrorInfo,
} from '../errors';
import {
  Core,
  defaultConnect,
  type CallOptions,
  type HopStatus,
  type ResolvedOptions,
  type RdapWhoisOptions,
  type Running,
} from '../core';
import { resolveProxy } from '../net/proxy';
import { checkWhoisTarget } from '../net/targets';
import { openConnection } from '../net/tunnel';
import { detectQueryType, normalizeQuery } from '../query';
import type { WhoisDataType, WhoisServerType } from './data-types';
import { resolveFormat } from './formats';
import { detectMeta, parseBlocks } from './mapping';
import { normalizeRawText } from './raw-text';
import {
  getQueryString,
  getServerConfig,
  getTldServer,
  getTldZone,
  getWhoisServer,
  parseReferralServer,
} from './servers';
import { whoisExchange } from './socket';

export interface WhoisCallOptions extends CallOptions {
  /** ask this server instead of the one the routing data names */
  server?: string;
  /** the port to connect to. Default 43 */
  port?: number;
  /** what the query is, when it should not be worked out from its text */
  queryType?: QueryType;
  /**
   * the character encoding of the first server's response, as TextDecoder names it, in
   * place of the one the routing data has for that server. Default: the routing data's,
   * else utf-8. A referral is always read in its own server's encoding
   */
  encoding?: string;
}

/**
 * one server's part in a WHOIS lookup. `status` says what the rest holds: an answer always
 * has `raw` and `data`, and a failed hop always has `error`
 */
export type WhoisHop = {
  server: string;
  serverType: WhoisServerType;
  // the line that was sent
  queryString: string;
  // how many times the request was sent
  tries: number;
  // how long the hop took in milliseconds, retries and waiting included
  elapsed: number;
} & (
  | { status: 'found' | 'reserved'; raw: string; data: WhoisDataType; error?: undefined }
  // `raw` is the response text and `data` the fields parsed from it, or null when there
  // was no response
  | { status: 'notfound'; raw: string | null; data: WhoisDataType | null; error?: undefined }
  | { status: 'error'; raw: string | null; data: WhoisDataType | null; error: ErrorInfo }
);

// ask one WHOIS server, with retries. Throws when the server gave no usable response
async function whoisHop(
  core: Core,
  server: string,
  query: string,
  queryType: QueryType,
  options: Running<ResolvedOptions & WhoisCallOptions>,
  referral = false
): Promise<WhoisHop> {
  const started = Date.now();
  const config = getServerConfig(server);
  const queryString = getQueryString(config, query, queryType);
  const port = options.port ?? 43;
  const context = { protocol: 'whois' as const, server, query: queryString };

  const { value, tries } = await core.withRetries(
    'whois',
    server,
    options,
    async (attempt, _limited, timeout) => {
      const exchangeStarted = Date.now();
      const proxy = resolveProxy(options.proxy, 'whois');
      const report = (bytes: number, error?: unknown) =>
        core.emit(options, {
          type: 'request',
          protocol: 'whois',
          server,
          query: queryString,
          attempt,
          elapsed: Date.now() - exchangeStarted,
          bytes,
          proxied: !!proxy,
          ...(error === undefined ? {} : { error: toErrorInfo(error) }),
        });

      // One deadline for the connect and the exchange together, so a slow connect leaves
      // the exchange only what is left of the timeout. Through a proxy with a
      // connectTimeout of its own, the proxy leg is bounded by that, and the deadline
      // starts once the tunnel is up. Without one, the proxy leg shares the deadline
      const started = Date.now();
      let text: string;
      try {
        const connection = await openConnection(
          { host: server, port },
          {
            connect: options.connect ?? (await defaultConnect()),
            proxy,
            timeout,
            signal: options.run.signal,
          }
        );
        const ends = (proxy?.connectTimeout !== undefined ? Date.now() : started) + timeout;
        text = await whoisExchange(connection, queryString, {
          timeout: Math.max(1, ends - Date.now()),
          maxResponseBytes: options.maxResponseBytes,
          encoding: options.encoding ?? config.encoding,
          signal: options.run.signal,
        });
        if (!text.trim()) throw new EmptyResponseError(`${server} sent an empty response`);
      } catch (caught) {
        const error = caught instanceof RdapWhoisError ? withErrorContext(caught, context) : caught;
        report(0, error);
        throw error;
      }
      report(new TextEncoder().encode(text).length);

      const raw = normalizeRawText(text);
      const parsed = parseBlocks(raw, server, queryType);
      // a throttle page is not an answer: it goes back through the retry loop
      if (parsed.status === 'throttled') {
        throw new RateLimitError(`${server} is rate limiting`, {
          ...context,
          raw,
        });
      }
      return { raw, parsed };
    },
    { referral }
  );

  const { raw, parsed } = value;
  const fields = { server, serverType: config.serverType, queryString };
  // the server answered, but with an error message of its own instead of a record
  if (parsed.status === 'error' || parsed.status === 'throttled') {
    return {
      ...fields,
      status: 'error',
      raw,
      data: parsed.data,
      error: toErrorInfo(
        new ServerError(`${server} answered with an error instead of a record`, context)
      ),
      tries,
      elapsed: Date.now() - started,
    };
  }
  return {
    ...fields,
    status: parsed.status,
    raw,
    data: parsed.data,
    tries,
    elapsed: Date.now() - started,
  };
}

// one whois() call, inside a running call. The combined client calls it for lookup()
export async function whoisCall(
  core: Core,
  query: string,
  options: Running<ResolvedOptions & WhoisCallOptions>
): Promise<WhoisHop[]> {
  const queryType = options.queryType ?? detectQueryType(query);
  const text = normalizeQuery(query, queryType);

  const first = normalizeServer(options.server ?? getWhoisServer(queryType, text) ?? '');
  if (!first) {
    throw new NoServerError(`No WHOIS server is known for "${text}"`, {
      protocol: 'whois',
      query: text,
    });
  }
  // the first server is the caller's to choose, through `server` or the target policy, so
  // a refusal is a problem with the call
  const allowed = checkWhoisTarget(first, options.port ?? 43, options.targets);
  if (!allowed.ok) {
    throw new InvalidQueryError(allowed.reason, {
      protocol: 'whois',
      server: first,
      query: text,
    });
  }

  return core.cached(
    {
      protocol: 'whois',
      server: first,
      query: text,
      queryType,
      ...(options.encoding ? { encoding: options.encoding } : {}),
    },
    options,
    () => whoisChain(core, first, text, queryType, options)
  );
}

// ask the first server, then follow the referral to the registrar's server
async function whoisChain(
  core: Core,
  first: string,
  text: string,
  queryType: QueryType,
  options: Running<ResolvedOptions & WhoisCallOptions>
): Promise<WhoisHop[]> {
  const hops: WhoisHop[] = [await whoisHop(core, first, text, queryType, options)];
  const visited = new Set([first]);
  for (let remaining = options.followReferrals; remaining > 0; remaining--) {
    const last = hops[hops.length - 1];
    // only an answer can refer anywhere, and a bare TLD's record names the registry's
    // server without that being a referral for the TLD
    if (last.status !== 'found' && last.status !== 'reserved') break;
    if (isTld(text)) break;

    const referral = parseReferralServer(last.raw);
    if (!referral || visited.has(referral)) break;
    visited.add(referral);
    core.emit(options, { type: 'referral', protocol: 'whois', from: last.server, to: referral });

    // a referral's port is the default one and its encoding its own: the port and encoding
    // options were for the first server
    const referralOptions = { ...options, port: undefined, encoding: undefined };
    const referralStarted = Date.now();
    try {
      // a referral comes from a server's response, so a refusal is a problem with it
      const target = checkWhoisTarget(referral, 43, options.targets);
      if (!target.ok) {
        throw new InvalidResponseError(`${last.server} referred to ${referral}: ${target.reason}`, {
          protocol: 'whois',
          server: referral,
          query: text,
        });
      }
      // a referral to the server that holds the record keeps the tunnel retry: any referral
      // from IANA (to a regional registry, or the registry of a TLD the routing data does
      // not list), and one to a regional registry or registry (ARIN to RIPE for transferred
      // space). Only a referral to a registrar, after the registry has answered, is optional
      const holdsRecord =
        last.serverType === IANA_SERVER_TYPE ||
        [REGIONAL_SERVER_TYPE, REGISTRY_SERVER_TYPE].includes(getServerConfig(referral).serverType);
      hops.push(await whoisHop(core, referral, text, queryType, referralOptions, !holdsRecord));
    } catch (error) {
      if (options.signal?.aborted) throw error;
      // the earlier answer stands; the failed server is reported beside it
      const config = getServerConfig(referral);
      hops.push({
        server: referral,
        serverType: config.serverType,
        queryString: getQueryString(config, text, queryType),
        status: 'error',
        raw: error instanceof RateLimitError ? (error.raw ?? null) : null,
        data: null,
        error: toErrorInfo(error),
        tries: error instanceof RdapWhoisError ? (error.tries ?? 1) : 1,
        elapsed: Date.now() - referralStarted,
      });
      break;
    }
  }
  return hops;
}

/** what parseWhois() makes of a response */
export interface ParsedWhois {
  /** 'throttled' when the response is a rate-limit page rather than an answer */
  status: HopStatus | 'throttled';
  /** the fields read from the response; null when it is not an answer */
  data: WhoisDataType | null;
}

/**
 * Parse a WHOIS response that was fetched some other way or kept from earlier, as the
 * client parses one it fetched: `server` picks the server's own format, and `queryType`
 * what kind of object to read
 */
export function parseWhois(
  raw: string,
  server: string,
  queryType: QueryType = 'domain'
): ParsedWhois {
  const parsed = parseBlocks(normalizeRawText(raw), normalizeServer(server), queryType);
  return { status: parsed.status, data: parsed.status === 'throttled' ? null : parsed.data };
}

// whether the routing data has the registry's own WHOIS server for a domain's TLD, rather
// than only IANA to ask
export function hasTldServer(domain: string): boolean {
  return Boolean(getTldServer(domain));
}

export { getTldZone, getWhoisServer };

/**
 * The line of a WHOIS response that marks it as a rate-limit page, as the server wrote it,
 * or null when the response is not one. parseWhois() reports such a response as
 * 'throttled'; this says which line made it so
 */
export function whoisThrottleLine(raw: string, server: string): string | null {
  const host = normalizeServer(server);
  return detectMeta(raw, resolveFormat(host), host).throttled ?? null;
}
