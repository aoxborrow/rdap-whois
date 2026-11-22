// Fetch + classify one RDAP base URL (docs/registry-health.md §5). Extracted from
// check-rdap.ts so the M2 sweep AND rdap:discover (§10.4) verify endpoints identically.
// Reads the HTTP exchange itself rather than an interpreted hop: probes must follow 3xx
// manually, must not retry 404s, and an RDAP 404 error body IS a liveness positive — a
// conformant "no such object" proves the server works. Through the library's own fetch
// (scripts/lib/client.ts); behind the rotating proxy each request opens its own tunnel, so
// each leaves from a fresh address.
import { isRdapResponse } from '../../../src/rdap/utils';
import { TOOLING_USER_AGENT, toolingFetch } from '../../lib/client';
import type { ProbeClassification } from '../../registry-health/state';

export const RDAP_TIMEOUT_MS = 8000;
export const RDAP_MAX_REDIRECTS = 3;

export type RdapProbeOutcome = { classification: ProbeClassification; detail?: string };

const probeFetch = toolingFetch(RDAP_TIMEOUT_MS);

// fetch with the User-Agent, a timeout, and 3xx followed by hand
export async function fetchRdap(
  url: string,
  redirects = 0
): Promise<{ status: number; body: string }> {
  const signal = AbortSignal.timeout(RDAP_TIMEOUT_MS);
  const response = await probeFetch(url, {
    method: 'GET',
    headers: {
      'User-Agent': TOOLING_USER_AGENT,
      'Accept': 'application/json,application/rdap+json',
    },
    redirect: 'manual',
    signal,
  });
  if (response.status >= 300 && response.status < 400 && redirects < RDAP_MAX_REDIRECTS) {
    const target = response.headers.get('location');
    await response.body?.cancel();
    if (target) {
      return fetchRdap(new URL(target, url).href, redirects + 1);
    }
  }
  return { status: response.status, body: await response.text() };
}

export function classifyRdap(status: number, body: string): RdapProbeOutcome {
  // parse the body and test RDAP conformance (errorCode number or non-empty
  // rdapConformance) — the SAME guard the tool uses. A conformant body proves the
  // endpoint speaks RDAP, whatever the status.
  let json: unknown;
  try {
    json = JSON.parse(body) as unknown;
  } catch {
    json = undefined;
  }
  const conformant = json !== undefined && isRdapResponse(json);

  if (status === 429) {
    return { classification: 'throttled', detail: '429' };
  }
  // liveness = a conformant RDAP body. A 404 whose body is a real RDAP "no such object"
  // (errorCode 404) proves the server works; a 200 with a proper response likewise.
  if (conformant) {
    return {
      classification: 'healthy',
      detail: status === 404 ? '404 (conformant no-such-object)' : undefined,
    };
  }
  // responded, but NOT with RDAP. A bare HTML/landing/proxy page (common on stale base
  // URLs) must not count as healthy — it would reset the failure counter and hide a
  // dead endpoint. Classify by why it's non-conformant; suspect never feeds phase-out.
  if (status >= 200 && status < 300) {
    return { classification: 'suspect', detail: '2xx but non-conformant body' };
  }
  if (status === 404) {
    return { classification: 'suspect', detail: '404 non-conformant (stale base URL?)' };
  }
  if (status >= 300 && status < 400) {
    return { classification: 'suspect', detail: `redirect loop past ${RDAP_MAX_REDIRECTS} hops` };
  }
  return { classification: 'suspect', detail: `HTTP ${status} non-conformant` };
}

// probe one base URL at a sample path: fetch, classify, dead-candidate on network throw.
// `base` already carries its single trailing slash (normalized form) so `${base}${path}`
// never double-slashes.
export async function probeRdapBase(base: string, path: string): Promise<RdapProbeOutcome> {
  try {
    const { status, body } = await fetchRdap(`${base}${path}`);
    return classifyRdap(status, body);
  } catch (error) {
    return {
      classification: 'dead-candidate',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
