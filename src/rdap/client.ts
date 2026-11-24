// The RDAP client: asks the server the bootstrap data names (or the one given), follows
// redirects and the registry's link to the registrar, and returns every server's answer.
// It shares the retry loop, limiter and cache with the WHOIS client through Core, and
// imports nothing from the WHOIS side.
import {
  DOMAIN_QUERY_TYPE,
  ENTITY_QUERY_TYPE,
  REGISTRAR_SERVER_TYPE,
  type QueryType,
} from '../common/constants';
import {
  InvalidQueryError,
  InvalidResponseError,
  NoServerError,
  ProxyError,
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
  isWorkers,
  type CallOptions,
  type HopStatus,
  type ResolvedOptions,
  type RdapWhoisOptions,
  type Running,
} from '../core';
import { resolveProxy } from '../net/proxy';
import { createProxyFetch } from '../net/proxy-fetch';
import { openConnection } from '../net/tunnel';
import { detectQueryType, normalizeQuery } from '../query';
import {
  interpretRdapResponse,
  isRedirect,
  rdapHttpGet,
  type FetchLike,
  type RdapAnswer,
  type RdapHttpResponse,
} from './request';
import { getRdapServer, getServerType as getRdapServerType } from './servers';
import type { RdapResponse, RdapServerType } from './types';
import {
  findLinkByRel,
  getRdapQueryPath,
  isDomainResponse,
  isErrorResponse,
  isObjectResponse,
  isRdapResponse,
  normalizeRdapServer,
  stripRdapEndpoint,
} from './utils';
import { validateRdapDomain } from './validate';

export interface RdapCallOptions extends CallOptions {
  /** ask this server instead of the one the bootstrap data names, as a base URL */
  server?: string;
  /** what the query is, when it should not be worked out from its text */
  queryType?: QueryType;
}

/**
 * one server's part in an RDAP lookup. `status` says what the rest holds: an answer always
 * has `data`, and a failed hop always has `error`
 */
export type RdapHop = {
  /** the server's base URL */
  server: string;
  serverType: RdapServerType;
  // the URL that was requested
  url: string;
  // the URL that answered, when redirects led somewhere else
  finalUrl?: string;
  // the HTTP status of the response, or null when there was none
  httpStatus: number | null;
  // how many times the request was sent
  tries: number;
  // how long the hop took in milliseconds, retries and waiting included
  elapsed: number;
} & (
  | { status: 'found'; data: RdapResponse; error?: undefined }
  // `data` is the RDAP error body the server sent with its "not found", when it sent one
  | { status: 'notfound'; data: RdapResponse | null; error?: undefined }
  // `data` is the RDAP error body the server sent, when it sent one
  | { status: 'error'; data: RdapResponse | null; error: ErrorInfo }
);

// an RDAP server as a base URL with one trailing slash. An http:// server the caller names
// is used as given; one from the bootstrap data or a referral link is upgraded to https
function rdapBase(server: string, named = false): string {
  const text = server.trim();
  if (named && /^http:\/\//i.test(text)) {
    return stripRdapEndpoint(text).replace(/\/+$/, '') + '/';
  }
  return normalizeRdapServer(text);
}

const hostOf = (url: string): string => new URL(url).hostname;

// the RDAP error body a failed request carried: a server error's body, or a throttle's
// response text when it is one
function rdapErrorBody(error: unknown): RdapResponse | null {
  let body: unknown = null;
  if (error instanceof ServerError) {
    body = error.body;
  } else if (error instanceof RateLimitError && error.raw) {
    try {
      body = JSON.parse(error.raw) as unknown;
    } catch {
      body = null;
    }
  }
  return isRdapResponse(body) && isErrorResponse(body) ? body : null;
}

// the fetch to make one RDAP request with, and whether it goes through a proxy
async function rdapFetch(
  options: ResolvedOptions
): Promise<{ fetch: FetchLike; proxied: boolean }> {
  if (options.fetch) return { fetch: options.fetch, proxied: false };

  const proxy = resolveProxy(options.proxy, 'rdap');
  if (!proxy) {
    return { fetch: (input, init) => fetch(input, init), proxied: false };
  }

  const connect = options.connect ?? (await defaultConnect());
  const proxyFetch = createProxyFetch({
    open: (to, signal) => openConnection(to, { connect, proxy, timeout: options.timeout, signal }),
    timeout: options.timeout,
    maxResponseBytes: options.maxResponseBytes,
  });
  return {
    fetch: (input, init) => proxyFetch(input, { headers: init.headers, signal: init.signal }),
    proxied: true,
  };
}

// ask one RDAP server, with retries. Throws when the server gave no usable response
async function rdapHop(
  core: Core,
  base: string,
  query: string,
  queryType: QueryType,
  options: Running,
  referral = false
): Promise<RdapHop> {
  const started = Date.now();
  const url = `${base}${getRdapQueryPath(queryType, query)}`;
  const host = hostOf(base);
  const context = { protocol: 'rdap' as const, server: base, query: url };

  // on Workers the runtime cannot do TLS inside a proxy tunnel, so the library's own proxy
  // client cannot make this request. Say so, instead of quietly going direct
  if (isWorkers() && !options.fetch) {
    if (resolveProxy(options.proxy, 'rdap')) {
      throw new ProxyError(
        'RDAP cannot go through a proxy on Cloudflare Workers with the built-in client. ' +
          "Pass the tunnelfetch package's client as the `fetch` option, or give a proxy " +
          'for WHOIS only: `proxy: { whois: url }`',
        { ...context, retryable: false }
      );
    }
  }

  const { value, tries } = await core.withRetries(
    'rdap',
    host,
    options,
    async (attempt, limited) => {
      let current = url;
      let redirects = 0;
      for (;;) {
        const exchangeStarted = Date.now();
        let proxied = false;
        const report = (bytes: number, status?: number, error?: unknown) =>
          core.emit(options, {
            type: 'request',
            protocol: 'rdap',
            server: base,
            query: current,
            attempt,
            elapsed: Date.now() - exchangeStarted,
            bytes,
            proxied,
            ...(status === undefined ? {} : { status }),
            ...(error === undefined ? {} : { error: toErrorInfo(error) }),
          });

        // each request takes the place of the host it goes to, and gives it up before a
        // redirect is followed: the redirect then waits its turn at the host it points to
        // (the same host included), and a throttle pauses the host that sent it
        const exchange = await limited<
          | { http: RdapHttpResponse; location: string }
          | { http: RdapHttpResponse; answer: RdapAnswer }
        >(hostOf(current), async timeout => {
          let http: RdapHttpResponse;
          try {
            const transport = await rdapFetch({ ...options, timeout });
            proxied = transport.proxied;
            http = await rdapHttpGet(current, {
              fetch: transport.fetch,
              timeout,
              maxResponseBytes: options.maxResponseBytes,
              userAgent: options.userAgent,
              signal: options.run.signal,
              followNatively: options.followRedirects > 0,
            });
          } catch (caught) {
            const error =
              caught instanceof RdapWhoisError ? withErrorContext(caught, context) : caught;
            report(0, undefined, error);
            throw error;
          }

          // a redirect is followed below, once this host's place is given up
          if (
            isRedirect(http.status) &&
            http.location &&
            options.followRedirects > 0 &&
            !http.followedNatively
          ) {
            report(http.bytes, http.status);
            return { http, location: http.location };
          }

          let answer: RdapAnswer;
          try {
            answer = interpretRdapResponse(http, current);
          } catch (caught) {
            const error =
              caught instanceof RdapWhoisError ? withErrorContext(caught, context) : caught;
            report(http.bytes, http.status, error);
            throw error;
          }
          report(http.bytes, http.status);
          return { http, answer };
        });

        const { http } = exchange;
        if ('answer' in exchange) return { answer: exchange.answer, http, finalUrl: current };

        // a redirect: check where it points before going there
        if (redirects >= options.followRedirects) {
          throw new ServerError(`${host} redirected more than ${options.followRedirects} times`, {
            ...context,
            status: http.status,
          });
        }
        const next = exchange.location;
        if (!/^https?:$/.test(new URL(next).protocol)) {
          throw new InvalidResponseError(
            `${host} redirected to ${next}, which is not an HTTP URL`,
            {
              ...context,
              status: http.status,
            }
          );
        }
        core.emit(options, {
          type: 'redirect',
          protocol: 'rdap',
          from: current,
          to: next,
          status: http.status,
        });
        redirects++;
        current = next;
      }
    },
    { eachHost: true, referral }
  );

  const { answer, http, finalUrl } = value;
  const fields = {
    server: base,
    serverType: getRdapServerType(queryType, query, base),
    url,
    ...(finalUrl === url ? {} : { finalUrl }),
  };
  const hop: RdapHop =
    answer.status === 'error'
      ? {
          ...fields,
          status: 'error',
          httpStatus: http.status,
          data: answer.data,
          error: toErrorInfo(answer.error),
          tries,
          elapsed: Date.now() - started,
        }
      : {
          ...fields,
          ...answer,
          httpStatus: http.status,
          tries,
          elapsed: Date.now() - started,
        };

  // a response about some other domain is not an answer to this query
  if (
    options.validate &&
    queryType === DOMAIN_QUERY_TYPE &&
    answer.status === 'found' &&
    isDomainResponse(answer.data)
  ) {
    const validation = validateRdapDomain(answer.data, query);
    if (validation.name === 'mismatch') {
      throw new InvalidResponseError(
        `${host} answered about "${validation.responseName}", not "${query}"`,
        { ...context, status: http.status }
      );
    }
  }
  return hop;
}

// one rdap() call, inside a running call. The combined client calls it for lookup()
export async function rdapCall(
  core: Core,
  query: string,
  options: Running<ResolvedOptions & RdapCallOptions>
): Promise<RdapHop[]> {
  const queryType = options.queryType ?? detectQueryType(query);
  const text = normalizeQuery(query, queryType);

  const server = options.server ?? getRdapServer(queryType, text);
  if (!server) {
    // an entity handle is placed only by its tag, so one without a known tag needs a server
    const hint =
      queryType === ENTITY_QUERY_TYPE ? '; pass `server` for a handle with no known tag' : '';
    throw new NoServerError(`No RDAP server is known for "${text}"${hint}`, {
      protocol: 'rdap',
      query: text,
    });
  }
  const first = rdapBase(server, options.server !== undefined);

  return core.cached({ protocol: 'rdap', server: first, query: text, queryType }, options, () =>
    rdapChain(core, first, text, queryType, options)
  );
}

// ask the first server, then follow the registry's link to the registrar
async function rdapChain(
  core: Core,
  first: string,
  text: string,
  queryType: QueryType,
  options: Running<ResolvedOptions & RdapCallOptions>
): Promise<RdapHop[]> {
  const hops: RdapHop[] = [await rdapHop(core, first, text, queryType, options)];
  const visited = new Set([hostOf(first)]);
  for (let remaining = options.followReferrals; remaining > 0; remaining--) {
    const last = hops[hops.length - 1];
    // only an answer can refer anywhere, and a registrar is the end of the chain. A server
    // the caller named is trusted to refer, whatever the data calls it
    if (last.status !== 'found' || !last.data || !isObjectResponse(last.data)) break;
    const named = hops.length === 1 && options.server !== undefined;
    if (last.serverType === REGISTRAR_SERVER_TYPE && !named) break;

    // the registrar's server, when the registry links to one. Some `related` links are
    // not RDAP servers (IANA's are web pages), so the media type has to say rdap
    const link = findLinkByRel(last.data.links, 'related');
    if (!link?.href || !link.type?.includes('rdap')) break;
    let linkHost: string;
    try {
      linkHost = new URL(link.href).hostname.toLowerCase();
    } catch {
      break;
    }
    if (visited.has(linkHost)) break;
    visited.add(linkHost);

    const referralStarted = Date.now();
    let referral = link.href;
    try {
      referral = rdapBase(link.href);
      core.emit(options, { type: 'referral', protocol: 'rdap', from: last.server, to: referral });
      hops.push(await rdapHop(core, referral, text, queryType, options, true));
    } catch (error) {
      if (options.signal?.aborted) throw error;
      // the earlier answer stands; the failed server is reported beside it, with the RDAP
      // error body it sent, when it sent one
      hops.push({
        server: referral,
        serverType: getRdapServerType(queryType, text, referral),
        url: referral,
        status: 'error',
        httpStatus:
          error instanceof ServerError
            ? (error.status ?? null)
            : error instanceof RateLimitError
              ? 429
              : null,
        data: rdapErrorBody(error),
        error: toErrorInfo(error),
        tries: error instanceof RdapWhoisError ? (error.tries ?? 1) : 1,
        elapsed: Date.now() - referralStarted,
      });
      break;
    }
  }
  return hops;
}
