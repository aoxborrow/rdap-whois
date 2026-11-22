import {
  ConnectionError,
  EmptyResponseError,
  InvalidResponseError,
  RateLimitError,
  ServerError,
  TimeoutError,
  RdapWhoisError,
} from '../errors';
import { abortable, abortReason, deadline } from '../net/deadline';
import type { RdapErrorResponse, RdapResponse } from './types';
import { isErrorResponse, isRdapResponse } from './utils';

// One RDAP request and what its response means. The redirect and referral loops, retries
// and events are the client's; this is the part between "here is a URL" and "here is what
// the server said".

// the part of fetch an RDAP request uses, so a caller's fetch, the runtime's and the
// library's own proxy client are interchangeable
export type FetchLike = (
  url: string,
  init: {
    method: 'GET';
    headers: Record<string, string>;
    redirect: 'manual' | 'follow';
    signal?: AbortSignal;
  }
) => Promise<Response>;

export interface RdapHttpOptions {
  fetch: FetchLike;
  // how long the request may take, in milliseconds
  timeout: number;
  // the largest body to accept, in bytes
  maxResponseBytes: number;
  // none is sent when this is undefined
  userAgent?: string;
  signal?: AbortSignal;
  // let the runtime follow a redirect it will not show the target of (a browser). Off
  // when the caller follows no redirects, since such a redirect cannot be checked first
  followNatively?: boolean;
}

export interface RdapHttpResponse {
  status: number;
  // the body as text; empty when there was none
  text: string;
  // bytes of body received
  bytes: number;
  // where a redirect points, resolved against the request URL
  location: string | null;
  // how long the server asked us to wait, in milliseconds
  retryAfter: number | null;
  // the runtime followed redirects itself because it would not show where they point
  followedNatively: boolean;
  // the URL the answer came from: the request URL, or where a native redirect ended
  finalUrl: string;
}

// the status texts an RDAP server is likely to answer with, so an error message reads the
// same on every runtime
const STATUS_TEXT: Record<number, string> = {
  301: 'Moved Permanently',
  302: 'Found',
  303: 'See Other',
  307: 'Temporary Redirect',
  308: 'Permanent Redirect',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  406: 'Not Acceptable',
  408: 'Request Timeout',
  410: 'Gone',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};
export const statusText = (status: number): string => STATUS_TEXT[status] ?? `HTTP ${status}`;

export const isRedirect = (status: number): boolean =>
  status === 301 || status === 302 || status === 303 || status === 307 || status === 308;

// a Retry-After header as milliseconds: either a number of seconds or an HTTP date
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | null {
  if (!value) return null;
  const text = value.trim();
  if (/^\d+$/.test(text)) return Number(text) * 1000;
  const date = Date.parse(text);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

// read a response body as text, giving up once it is larger than the cap
async function readBody(
  response: Response,
  maxBytes: number,
  signal: AbortSignal
): Promise<{ text: string; bytes: number }> {
  const tooLarge = () => new InvalidResponseError(`Response is larger than ${maxBytes} bytes`);
  const declared = Number(response.headers.get('content-length'));
  if (declared > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw tooLarge();
  }
  if (!response.body) {
    const text = await abortable(response.text(), signal);
    const bytes = new TextEncoder().encode(text).length;
    if (bytes > maxBytes) throw tooLarge();
    return { text, bytes };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await abortable(reader.read(), signal);
      if (done) break;
      bytes += value.length;
      if (bytes > maxBytes) throw tooLarge();
      text += decoder.decode(value, { stream: true });
    }
  } catch (error) {
    // stop the download: the rest of the body is not wanted
    await reader.cancel().catch(() => {});
    throw error;
  }
  return { text: text + decoder.decode(), bytes };
}

// what a failed fetch amounts to. Runtimes say very little: Node throws "fetch failed" and
// puts the reason on `cause`
function fetchError(error: unknown, host: string): Error {
  if (error instanceof RdapWhoisError) return error;
  const cause = (error as { cause?: unknown } | undefined)?.cause;
  const reason = cause instanceof Error ? cause : error instanceof Error ? error : undefined;
  const rawCode = (reason as { code?: unknown } | undefined)?.code;
  const code = typeof rawCode === 'string' ? rawCode : '';
  const message = reason?.message || String(error);
  if (/timeout|timed out|ETIMEDOUT/i.test(`${code} ${message}`)) {
    return new TimeoutError(`Timed out waiting for ${host}: ${message}`, { cause: error });
  }
  return new ConnectionError(`Request to ${host} failed: ${message}`, { cause: error });
}

// send one GET and read the response. Does not follow redirects, so the caller can check
// where each one points before going there
export async function rdapHttpGet(
  url: string,
  options: RdapHttpOptions
): Promise<RdapHttpResponse> {
  const host = new URL(url).host;
  const limit = deadline(options.timeout, `Timed out waiting for ${host}`, options.signal);
  const init = {
    method: 'GET' as const,
    headers: {
      Accept: 'application/json,application/rdap+json',
      ...(options.userAgent === undefined ? {} : { 'User-Agent': options.userAgent }),
    },
    signal: limit.signal,
  };
  try {
    let response: Response;
    let followedNatively = false;
    try {
      response = await abortable(options.fetch(url, { ...init, redirect: 'manual' }), limit.signal);
      // a browser will not say where a redirect points. The only way to the answer there is
      // to let it follow the redirect itself
      if (response.type === 'opaqueredirect') {
        if (!options.followNatively) {
          throw new ServerError(`${host} redirected, and redirects are not followed`, {
            protocol: 'rdap',
            query: url,
          });
        }
        followedNatively = true;
        response = await abortable(
          options.fetch(url, { ...init, redirect: 'follow' }),
          limit.signal
        );
      }
    } catch (error) {
      if (limit.signal.aborted) throw abortReason(limit.signal);
      throw fetchError(error, host);
    }

    let body: { text: string; bytes: number };
    try {
      body = await readBody(response, options.maxResponseBytes, limit.signal);
    } catch (error) {
      if (limit.signal.aborted) throw abortReason(limit.signal);
      throw fetchError(error, host);
    }

    const location = response.headers.get('location');
    let resolved: string | null = null;
    if (location) {
      try {
        resolved = new URL(location, url).href;
      } catch {
        resolved = null;
      }
    }
    return {
      status: response.status,
      text: body.text,
      bytes: body.bytes,
      location: resolved,
      retryAfter: parseRetryAfter(response.headers.get('retry-after')),
      followedNatively,
      finalUrl: followedNatively && response.url ? response.url : url,
    };
  } finally {
    limit.clear();
  }
}

// what the server said, when it said something usable
export type RdapAnswer =
  // the object asked for
  | { status: 'found'; data: RdapResponse }
  // the server has no such object. `data` is its RDAP error body when it sent one
  | { status: 'notfound'; data: RdapErrorResponse | null }
  // the server refused the request with an RDAP error body of its own (a 4xx other than 404)
  | { status: 'error'; data: RdapErrorResponse; error: ServerError };

// Decide what a response means. Returns an answer when the server gave one; throws when it
// did not, with a retryable error where sending the request again could help.
// an error body's errorCode. Some servers send it as a string ("404"), so a numeric string
// counts too. Null when the body is not an error
function errorCodeOf(json: RdapResponse): number | null {
  if (isErrorResponse(json)) return json.errorCode;
  const value: unknown = (json as { errorCode?: unknown }).errorCode;
  return typeof value === 'string' && /^\d{3}$/.test(value.trim()) ? Number(value) : null;
}

export function interpretRdapResponse(http: RdapHttpResponse, url: string): RdapAnswer {
  const { status, text } = http;
  const context = { protocol: 'rdap' as const, query: url };

  if (status === 200 && !text.trim()) {
    throw new EmptyResponseError(`${new URL(url).host} sent an empty response`, context);
  }

  // a throttle is never an answer, whatever its body says
  if (status === 429) {
    throw new RateLimitError(`${new URL(url).host} is rate limiting: ${statusText(status)}`, {
      ...context,
      raw: text || undefined,
      retryAfter: http.retryAfter ?? undefined,
    });
  }

  let json: unknown;
  let parseError: string | null = null;
  if (text.trim()) {
    try {
      json = JSON.parse(text) as unknown;
    } catch (error) {
      parseError = error instanceof Error ? error.message : 'not valid JSON';
    }
  }

  if (isRdapResponse(json)) {
    const bodyCode = errorCodeOf(json);
    if (bodyCode === null) {
      // an object with a non-2xx status is still the server's answer
      return { status: 'found', data: json };
    }
    // the error code in the body is the server's own account of what went wrong
    const code = bodyCode || status;
    if (code === 404) return { status: 'notfound', data: json };
    if (code === 429) {
      throw new RateLimitError(`${new URL(url).host} is rate limiting: ${json.title ?? ''}`, {
        ...context,
        raw: text,
        retryAfter: http.retryAfter ?? undefined,
      });
    }
    const title = json.title || statusText(code);
    const error = new ServerError(`${new URL(url).host} answered ${code}: ${title}`, {
      ...context,
      status: code,
      body: json,
    });
    // a server-side failure could clear up; a refusal of the request will not
    if (code >= 500) throw error;
    return { status: 'error', data: json, error };
  }

  if (status === 200) {
    throw new InvalidResponseError(
      parseError
        ? `Response is not JSON: ${parseError}`
        : 'Response is JSON but not an RDAP response',
      { ...context, status }
    );
  }
  if (status === 404) return { status: 'notfound', data: null };
  throw new ServerError(`${new URL(url).host} answered ${status}: ${statusText(status)}`, {
    ...context,
    status,
    body: text || undefined,
  });
}
