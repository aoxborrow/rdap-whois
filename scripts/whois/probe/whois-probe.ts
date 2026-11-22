// Probe one whois server through the library client and classify liveness + parse
// quality (docs/registry-health.md §5). Extracted from check-servers.ts so the M2 sweep
// AND whois:discover (§10.4) verify servers with the exact same harness — a discovered
// candidate is judged by the same rules that decide phase-outs. The client applies each
// server's own query string, the per-server limits and the proxy.
import { DOMAIN_REQUIRED_FIELDS } from '../../../src/whois/base';
import {
  ConnectionError,
  EmptyResponseError,
  ProxyError,
  RateLimitError,
  TimeoutError,
  type RdapWhois,
} from '../../../src/index';
import { toolingClient } from '../../lib/client';
import type { ProbeClassification } from '../../registry-health/state';

export const WHOIS_QUERY_TIMEOUT_MS = 10000;

export type WhoisProbeOutcome = {
  classification: ProbeClassification;
  // count of non-null DOMAIN_REQUIRED_FIELDS parsed (healthy responses only)
  score?: number;
  detail?: string;
};

let sharedClient: RdapWhois | undefined;

// classify per plan §5: throttled/notfound are ALIVE; only connection-level failures and
// suspect empties count toward phase-out evidence. A server that answers with an error
// page of its own instead of a record ("TLD is not supported.") is up but of no use for
// the TLD, so it is `refused`, which counts as a failure
export async function probeWhoisServer(
  server: string,
  query: string,
  timeout = WHOIS_QUERY_TIMEOUT_MS,
  client: RdapWhois = (sharedClient ??= toolingClient())
): Promise<WhoisProbeOutcome> {
  try {
    // the probe's own answer only: no referral, and no retry, so a throttle is seen as one
    const [hop] = await client.whois(query, {
      server,
      followReferrals: 0,
      retries: 0,
      timeout,
      totalTimeout: timeout * 2,
    });
    if (!hop?.raw) {
      return { classification: 'suspect', detail: 'no raw response' };
    }
    if (hop.status === 'error') {
      const page = hop.raw.trim().split('\n')[0]?.slice(0, 120) ?? '';
      return { classification: 'refused', detail: `error page: ${page}`.trim() };
    }
    // notfound on a known-registered probe: the server is up, but either the probe
    // domain lapsed or the parser's notfound pattern is a false positive
    if (hop.status === 'notfound') {
      return { classification: 'notfound-fp', detail: `notfound: ${query}` };
    }
    // parse score: how many of the canonical domain fields came out non-null
    const data: Record<string, unknown> = { ...hop.data };
    const score = DOMAIN_REQUIRED_FIELDS.filter(
      field => data[field] !== null && data[field] !== undefined
    ).length;
    return { classification: 'healthy', score };
  } catch (error) {
    if (error instanceof RateLimitError) {
      return { classification: 'throttled', detail: error.message };
    }
    if (error instanceof EmptyResponseError) {
      return { classification: 'suspect', detail: error.message };
    }
    // a call that ran out of its total time rejects with the runtime's own TimeoutError
    if (
      error instanceof TimeoutError ||
      (error instanceof Error && error.name === 'TimeoutError') ||
      error instanceof ConnectionError ||
      error instanceof ProxyError
    ) {
      return { classification: 'dead-candidate', detail: error.message };
    }
    return {
      classification: 'error',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
