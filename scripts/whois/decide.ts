// The registry-health decision engine (docs/registry-health.md §6). A PURE function
// over the refreshed truth (IANA sweep + RDAP bootstrap), the probe state, and the
// current routing map — no I/O, no network — so the rules are unit-testable and the
// orchestrator (registry-health.ts) owns all reading/writing.
//
// The engine turns raw probe findings into typed decisions. The load-bearing safety
// rules:
//   - A whois server is only phased out (routed to null) with THREE signals agreeing:
//     ≥N consecutive probe failures, IANA no longer lists a whois server for the TLD,
//     AND the TLD has a probe-verified WORKING RDAP route (§10.2 — its routed RDAP base
//     is currently `healthy` in state.rdap, not merely present in the IANA bootstrap; a
//     listed-but-dead endpoint does not count, since nulling the whois server would then
//     make the TLD unlookupable). ICANN's port-43 sunset is expected. The failures are
//     connection-level (`dead-candidate`) or a refusal page (`refused`, such as Identity
//     Digital's `TLD is not supported.` once a TLD left port 43); a refusal never counts
//     toward a moat outage, since the server is up.
//   - A ccTLD with whois and NO RDAP is the product's moat: a dead probe there is a
//     RED alert, never an auto-null — losing it means the TLD becomes unlookupable.
//   - Everything short of the full phase-out gate is reported as a candidate, not acted
//     on. Data drift alone is green-with-PR; only moat outages (and, later, top-100
//     parser regressions or a job error) turn the build red.

import type { ProbeRecord } from '../registry-health/state';

// ── Time-based thresholds (§10.3). A consecutive-failure COUNT silently encodes the run
// cadence ("×3" means 3 weeks only while runs are weekly), so the gates are wall-clock
// durations instead. All owner-tunable.

// How long a routed TLD must have been failing — measured from lastHealthyAt, or
// firstProbeAt if it never answered — before a phase-out (routing to null) is proposed.
export const PHASEOUT_MIN_AGE_DAYS = 45;

// Minimum failed-probe instances that must span that window: the minimum-evidence guard.
// BOTH must hold — wall-clock alone would let a stale state file qualify on its
// second-ever run; instance count alone re-couples to the run cadence.
export const PHASEOUT_MIN_FAILURES = 4;

// How long a dead MOAT server (whois + no RDAP → unlookupable TLD) must have been down
// before the build goes red. In the plan's 7–14d band; 14 preserves the prior behavior
// (MOAT_RED_THRESHOLD = 2 weekly runs ≈ 14 days). Anything fresher is a yellow watch —
// slow ccTLD servers and rotating-proxy-exit blips flake single runs.
export const MOAT_RED_AGE_DAYS = 14;

const DAY_MS = 86_400_000;

// How long the routed TLD has been unhealthy, in whole days: elapsed since it last
// answered (lastHealthyAt), or — if it never has — since we first probed it (firstProbeAt,
// added in §10.3 so "never worked" can age). FLOORED, not rounded: this feeds the
// phase-out/moat safety gates, and rounding would let a server 89.5d dead report 90 and
// clear the 90-day minimum early. Whole-day floor ⇒ the gate only opens at a full N days.
export function deadDaysSince(record: ProbeRecord, now: Date): number {
  const anchor = record.lastHealthyAt ?? record.firstProbeAt;
  if (!anchor) return 0;
  return Math.max(0, Math.floor((now.getTime() - new Date(anchor).getTime()) / DAY_MS));
}

export type DecisionInputs = {
  // current merged routing map (static ← auto), tld → server|null
  tldServers: Record<string, string | null>;
  // TLDs with an RDAP route at all — present in the merged RDAP layers (IANA bootstrap
  // ← discovered ← overrides, §10.4). Defines moat membership: a whois server with NO
  // entry here is the product's whois-only moat.
  rdapListedTlds: Set<string>;
  // TLDs whose routed RDAP base URL last probed `healthy` in state.rdap — the
  // probe-verified "working RDAP route" the phase-out gate requires (§10.2). A subset of
  // rdapListedTlds. The whois lane reads this from the COMMITTED rdap state (§10.1); it
  // never probes RDAP itself.
  rdapHealthyTlds: Set<string>;
  // IANA sweep result, tld → whether IANA currently lists a whois server
  ianaListsServer: Record<string, boolean>;
  // probe state, server host → record
  whoisState: Record<string, ProbeRecord>;
  // hand overrides (never touched; a TLD pinned here is exempt from phase-out)
  overriddenTlds: Set<string>;
  // TLDs already listed as moat outages in the committed decisions.json. A known outage
  // is still reported, but only one that was not known turns the run red, so an outage
  // that outlives the week it was first reported does not hold the alert open forever
  knownMoatOutages?: Set<string>;
  // injectable clock + tunable durations (default to the constants above; tests pin them)
  now?: Date;
  minAgeDays?: number;
  minFailures?: number;
  moatRedDays?: number;
};

export type PhaseoutDecision = {
  tld: string;
  server: string;
  consecutiveFailures: number;
  deadDays: number;
};
export type MoatOutage = {
  tld: string;
  server: string;
  consecutiveFailures: number;
  deadDays: number;
  detail: string | null;
};
export type Candidate = {
  tld: string;
  server: string;
  consecutiveFailures: number;
  deadDays: number;
  reason: string; // why it is NOT yet a phase-out
};
export type UnhealthyAdoption = {
  tld: string;
  server: string;
  classification: string;
  detail: string | null;
};

export type Decisions = {
  // TLDs to route to null (passed the full phase-out gate) → written to tlds-phaseout.json
  phaseout: PhaseoutDecision[];
  // dead whois with no RDAP fallback, down ≥MOAT_RED_AGE_DAYS — RED, never nulled
  moatOutages: MoatOutage[];
  // dead moat on first observation(s) — reported as a watch list, not yet red
  moatWatch: MoatOutage[];
  // dead/failing but missing a phase-out condition — reported, not acted on
  candidates: Candidate[];
  // a TLD whose merged route points at a server that probed unhealthy (e.g. a freshly
  // adopted IANA server that doesn't actually answer) — flag, don't auto-revert
  unhealthyRoutes: UnhealthyAdoption[];
  // whether the run should fail the build: a sustained moat outage the committed
  // decisions.json did not already list
  red: boolean;
};

// classifications the probe harness treats as ALIVE (never phase-out evidence)
const ALIVE = new Set(['healthy', 'notfound-fp', 'throttled']);

// is this a two-letter ccTLD (the moat set skews here, but the real signal is
// "has whois and no RDAP" — a ccTLD label just sharpens the report wording)
function isCcTld(tld: string): boolean {
  return tld.length === 2 && !tld.startsWith('xn--');
}

export function decide(inputs: DecisionInputs): Decisions {
  const {
    tldServers,
    rdapListedTlds,
    rdapHealthyTlds,
    ianaListsServer,
    whoisState,
    overriddenTlds,
    knownMoatOutages = new Set<string>(),
    now = new Date(),
    minAgeDays = PHASEOUT_MIN_AGE_DAYS,
    minFailures = PHASEOUT_MIN_FAILURES,
    moatRedDays = MOAT_RED_AGE_DAYS,
  } = inputs;

  const phaseout: PhaseoutDecision[] = [];
  const moatOutages: MoatOutage[] = [];
  const moatWatch: MoatOutage[] = [];
  const candidates: Candidate[] = [];
  const unhealthyRoutes: UnhealthyAdoption[] = [];

  for (const [tld, server] of Object.entries(tldServers)) {
    if (!server) continue; // already no-whois; nothing to phase out
    const record = whoisState[server];
    if (!record) continue; // server not probed this run
    if (ALIVE.has(record.classification)) continue; // healthy/throttled/notfound — fine
    // connection-level death drives phase-out / moat-red, and a refusal page drives
    // phase-out only. A `suspect` (empty or non-conformant response) or `error` is tracked
    // separately (docs §5) and surfaced as an unhealthy route below — its failure counter
    // must NOT accumulate a TLD toward nulling a server or a red moat outage.
    const refused = record.classification === 'refused';
    if (record.classification !== 'dead-candidate' && !refused) continue;
    // a refusal is about the TLD that was asked: a server shared by several TLDs may refuse
    // one and still answer the rest, so it counts only for the TLD of the probe's query
    if (refused && !record.probeQuery?.toLowerCase().endsWith(`.${tld}`)) continue;

    const failures = record.consecutiveFailures;
    const deadDays = deadDaysSince(record, now);
    const hasRdapRoute = rdapListedTlds.has(tld); // any RDAP route → not the moat
    const hasWorkingRdap = rdapHealthyTlds.has(tld); // probe-verified route → phase-out ok

    // moat: dead whois AND no RDAP route at all → the TLD would become unlookupable.
    // Never null. Down longer than the red window is an outage; fresher is a watch entry
    // (slow ccTLD servers and rotating-exit failures flake single runs).
    if (!hasRdapRoute) {
      // a server that refuses is up: it stays an unhealthy route, never a moat outage
      if (refused) continue;
      const entry: MoatOutage = {
        tld,
        server,
        consecutiveFailures: failures,
        deadDays,
        detail: record.detail,
      };
      if (deadDays >= moatRedDays) {
        moatOutages.push(entry);
      } else {
        moatWatch.push(entry);
      }
      continue;
    }

    // a hand-overridden TLD is the owner's call — surface it but never touch it
    if (overriddenTlds.has(tld)) {
      candidates.push({
        tld,
        server,
        consecutiveFailures: failures,
        deadDays,
        reason: 'pinned in tlds-overrides.json (owner-managed)',
      });
      continue;
    }

    // §10.2: the TLD has an RDAP route on paper, but it did NOT probe healthy. Nulling
    // the whois server here could make the TLD unlookupable (dead whois + dead RDAP), so
    // it stays a candidate, never a phase-out — until the RDAP route is probe-verified
    // (or discovery finds a working one, §10.4).
    if (!hasWorkingRdap) {
      candidates.push({
        tld,
        server,
        consecutiveFailures: failures,
        deadDays,
        reason: 'RDAP listed but unhealthy',
      });
      continue;
    }

    // full phase-out gate (§10.3): dead ≥minAgeDays AND ≥minFailures instances span that
    // window AND IANA agrees the server is gone — plus the probe-verified working RDAP
    // route guaranteed by the guard above.
    const ianaGone = ianaListsServer[tld] === false;
    if (deadDays >= minAgeDays && failures >= minFailures && ianaGone) {
      phaseout.push({ tld, server, consecutiveFailures: failures, deadDays });
      continue;
    }

    // dead but a condition is unmet — report why, don't act
    const missing: string[] = [];
    if (deadDays < minAgeDays) missing.push(`dead only ${deadDays}d (<${minAgeDays}d)`);
    if (failures < minFailures) missing.push(`only ${failures} failed probe(s) (<${minFailures})`);
    if (!ianaGone) missing.push('IANA still lists a whois server');
    candidates.push({
      tld,
      server,
      consecutiveFailures: failures,
      deadDays,
      reason: missing.join('; ') || 'awaiting confirmation',
    });
  }

  // a route pointing at a server that probed unhealthy but isn't a phase-out/moat case
  // (e.g. suspect/error classification) — worth a human look
  for (const [tld, server] of Object.entries(tldServers)) {
    if (!server) continue;
    const record = whoisState[server];
    if (!record || ALIVE.has(record.classification)) continue;
    if (
      record.classification === 'suspect' ||
      record.classification === 'error' ||
      record.classification === 'refused'
    ) {
      unhealthyRoutes.push({
        tld,
        server,
        classification: record.classification,
        detail: record.detail,
      });
    }
  }

  // stable ordering for reproducible reports/diffs
  const byTld = (a: { tld: string }, b: { tld: string }) => a.tld.localeCompare(b.tld);
  phaseout.sort(byTld);
  moatOutages.sort(byTld);
  moatWatch.sort(byTld);
  candidates.sort(byTld);
  unhealthyRoutes.sort(byTld);

  return {
    phaseout,
    moatOutages,
    moatWatch,
    candidates,
    unhealthyRoutes,
    red: moatOutages.some(m => !knownMoatOutages.has(m.tld)),
  };
}

// dead ccTLD count for report wording
export function countCcMoatOutages(moatOutages: MoatOutage[]): number {
  return moatOutages.filter(m => isCcTld(m.tld)).length;
}

// Build the phase-out layer as the UNION of the prior committed entries and this run's
// decisions. decide() can't re-propose a TLD already routed to null (its server is null
// in the merged map, so it's skipped), so the file must accumulate — writing only the
// current run's decisions would silently restore previously-dead routes. Overridden
// TLDs are dropped (the override layer supersedes); output is sorted for a stable diff.
export function mergePhaseout(
  existingTlds: string[],
  newDecisions: PhaseoutDecision[],
  overriddenTlds: Set<string>
): Record<string, null> {
  const tlds = new Set<string>();
  for (const tld of existingTlds) if (!overriddenTlds.has(tld)) tlds.add(tld);
  for (const p of newDecisions) if (!overriddenTlds.has(p.tld)) tlds.add(p.tld);
  return Object.fromEntries([...tlds].sort().map(tld => [tld, null]));
}
