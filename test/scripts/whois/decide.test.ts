import { describe, expect, it } from 'vitest';
import {
  decide,
  mergePhaseout,
  MOAT_RED_AGE_DAYS,
  PHASEOUT_MIN_AGE_DAYS,
  PHASEOUT_MIN_FAILURES,
} from '../../../scripts/whois/decide';
import type { ProbeRecord } from '../../../scripts/registry-health/state';

// fixed clock so the time-based gates (§10.3) are deterministic
const NOW = new Date('2026-07-14T00:00:00Z');
const DAY = 86_400_000;
const daysAgo = (n: number): string => new Date(NOW.getTime() - n * DAY).toISOString();

// ages relative to the tunable thresholds, so these tests survive a constant change
const OLD_DAYS = PHASEOUT_MIN_AGE_DAYS + 30; // safely past the phase-out age gate
const YOUNG_DAYS = Math.floor(PHASEOUT_MIN_AGE_DAYS / 2); // short of the phase-out age gate
const FRESH_MOAT_DAYS = Math.floor(MOAT_RED_AGE_DAYS / 2); // short of the moat-red window

// build a ProbeRecord with just the fields decide() reads. Defaults model a server that
// has NEVER answered (lastHealthyAt null) and was first seen OLD_DAYS ago, so it clears
// the phase-out age gate unless a test overrides firstProbeAt/lastHealthyAt.
function record(
  classification: ProbeRecord['classification'],
  consecutiveFailures: number,
  opts: {
    firstProbeAt?: string;
    lastHealthyAt?: string | null;
    detail?: string | null;
    probeQuery?: string;
  } = {}
): ProbeRecord {
  return {
    classification,
    consecutiveFailures,
    firstProbeAt: opts.firstProbeAt ?? daysAgo(OLD_DAYS),
    lastProbeAt: NOW.toISOString(),
    lastHealthyAt: opts.lastHealthyAt ?? null,
    probeQuery: opts.probeQuery ?? 'nic.example',
    score: null,
    detail: opts.detail ?? null,
  };
}

// baseline inputs: one healthy gTLD with RDAP; override to exercise each rule. `now` is
// pinned so deadDaysSince() is deterministic.
function inputs(overrides: Partial<Parameters<typeof decide>[0]> = {}) {
  return {
    tldServers: { com: 'whois.verisign-grs.com' },
    rdapListedTlds: new Set(['com']),
    rdapHealthyTlds: new Set(['com']),
    ianaListsServer: { com: true },
    whoisState: { 'whois.verisign-grs.com': record('healthy', 0) },
    overriddenTlds: new Set<string>(),
    now: NOW,
    ...overrides,
  };
}

describe('registry-health decide()', () => {
  it('acts on nothing when every probed server is healthy', () => {
    const d = decide(inputs());
    expect(d.phaseout).toEqual([]);
    expect(d.moatOutages).toEqual([]);
    expect(d.candidates).toEqual([]);
    expect(d.red).toBe(false);
  });

  it('treats throttled and notfound-fp as alive (never phase-out evidence)', () => {
    const d = decide(
      inputs({
        tldServers: { com: 'whois.verisign-grs.com', net: 'whois.throttled' },
        rdapListedTlds: new Set(['com', 'net']),
        rdapHealthyTlds: new Set(['com', 'net']),
        ianaListsServer: { com: true, net: false },
        whoisState: {
          'whois.verisign-grs.com': record('notfound-fp', 0),
          'whois.throttled': record('throttled', 0),
        },
      })
    );
    expect(d.phaseout).toEqual([]);
    expect(d.candidates).toEqual([]);
    expect(d.red).toBe(false);
  });

  it('phases out a server past the age + failure + IANA + working-RDAP gate', () => {
    const d = decide(
      inputs({
        tldServers: { app: 'whois.nic.google' },
        rdapListedTlds: new Set(['app']),
        rdapHealthyTlds: new Set(['app']), // has a working RDAP fallback
        ianaListsServer: { app: false }, // IANA dropped the whois line
        whoisState: { 'whois.nic.google': record('dead-candidate', PHASEOUT_MIN_FAILURES) },
      })
    );
    expect(d.phaseout).toEqual([
      {
        tld: 'app',
        server: 'whois.nic.google',
        consecutiveFailures: PHASEOUT_MIN_FAILURES,
        deadDays: OLD_DAYS,
      },
    ]);
    expect(d.moatOutages).toEqual([]);
    expect(d.red).toBe(false);
  });

  it('does NOT phase out below the minimum failure count, even when old enough', () => {
    const d = decide(
      inputs({
        tldServers: { app: 'whois.nic.google' },
        rdapListedTlds: new Set(['app']),
        rdapHealthyTlds: new Set(['app']),
        ianaListsServer: { app: false },
        // old enough (OLD_DAYS) but only MIN-1 failed instances span the window
        whoisState: { 'whois.nic.google': record('dead-candidate', PHASEOUT_MIN_FAILURES - 1) },
      })
    );
    expect(d.phaseout).toEqual([]);
    expect(d.candidates).toHaveLength(1);
    expect(d.candidates[0].reason).toContain('failed probe');
  });

  it('does NOT phase out below the minimum age, even with many failures (§10.3)', () => {
    const d = decide(
      inputs({
        tldServers: { app: 'whois.nic.google' },
        rdapListedTlds: new Set(['app']),
        rdapHealthyTlds: new Set(['app']),
        ianaListsServer: { app: false },
        // plenty of failures but first seen only YOUNG_DAYS ago (a stale state file on an
        // early run must not qualify on wall-clock alone)
        whoisState: {
          'whois.nic.google': record('dead-candidate', PHASEOUT_MIN_FAILURES + 10, {
            firstProbeAt: daysAgo(YOUNG_DAYS),
          }),
        },
      })
    );
    expect(d.phaseout).toEqual([]);
    expect(d.candidates).toHaveLength(1);
    expect(d.candidates[0].reason).toContain('dead only');
    expect(d.candidates[0].deadDays).toBe(YOUNG_DAYS);
  });

  it('does NOT phase out while IANA still lists a whois server', () => {
    const d = decide(
      inputs({
        tldServers: { app: 'whois.nic.google' },
        rdapListedTlds: new Set(['app']),
        rdapHealthyTlds: new Set(['app']),
        ianaListsServer: { app: true }, // IANA still lists a server
        whoisState: { 'whois.nic.google': record('dead-candidate', PHASEOUT_MIN_FAILURES + 5) },
      })
    );
    expect(d.phaseout).toEqual([]);
    expect(d.candidates).toHaveLength(1);
    expect(d.candidates[0].reason).toContain('IANA still lists');
  });

  it('does NOT phase out when RDAP is listed but not probe-verified healthy (§10.2)', () => {
    // .app has an RDAP route in the bootstrap, but the live probe found it unhealthy —
    // nulling the (fully-failed, IANA-dropped) whois server would make .app unlookupable,
    // so it stays a candidate, never a phase-out, and is NOT treated as a moat outage.
    const d = decide(
      inputs({
        tldServers: { app: 'whois.nic.google' },
        rdapListedTlds: new Set(['app']), // bootstrap lists an RDAP endpoint for .app
        rdapHealthyTlds: new Set<string>(), // ...but it did not probe healthy
        ianaListsServer: { app: false },
        whoisState: { 'whois.nic.google': record('dead-candidate', PHASEOUT_MIN_FAILURES + 5) },
      })
    );
    expect(d.phaseout).toEqual([]);
    expect(d.moatOutages).toEqual([]); // has an RDAP route → not the moat
    expect(d.candidates).toHaveLength(1);
    expect(d.candidates[0].reason).toBe('RDAP listed but unhealthy');
    expect(d.red).toBe(false);
  });

  it('flags a long-dead server with NO RDAP as a red moat outage, never phased out', () => {
    const d = decide(
      inputs({
        tldServers: { xx: 'whois.nic.xx' },
        rdapListedTlds: new Set<string>(),
        rdapHealthyTlds: new Set<string>(), // no RDAP fallback — moat
        ianaListsServer: { xx: false },
        whoisState: { 'whois.nic.xx': record('dead-candidate', 5) }, // dead OLD_DAYS (default)
      })
    );
    expect(d.moatOutages).toEqual([
      {
        tld: 'xx',
        server: 'whois.nic.xx',
        consecutiveFailures: 5,
        deadDays: OLD_DAYS,
        detail: null,
      },
    ]);
    expect(d.moatWatch).toEqual([]);
    expect(d.phaseout).toEqual([]); // even long-dead + IANA-gone: never null a moat
    expect(d.red).toBe(true); // sustained moat outage turns the build red
  });

  it('holds a freshly-dead moat as a watch entry, not red', () => {
    const d = decide(
      inputs({
        tldServers: { xx: 'whois.nic.xx' },
        rdapListedTlds: new Set<string>(),
        rdapHealthyTlds: new Set<string>(),
        ianaListsServer: { xx: false },
        // dead only FRESH_MOAT_DAYS — inside the watch window, short of moat-red
        whoisState: {
          'whois.nic.xx': record('dead-candidate', 1, { firstProbeAt: daysAgo(FRESH_MOAT_DAYS) }),
        },
      })
    );
    expect(d.moatWatch.map(m => m.tld)).toEqual(['xx']);
    expect(d.moatOutages).toEqual([]);
    expect(d.red).toBe(false); // a fresh outage on a slow ccTLD server is not red
  });

  it('ages from lastHealthyAt when the server was once healthy', () => {
    // a server that answered YOUNG_DAYS ago but has failed since is only YOUNG_DAYS dead,
    // even if it was first probed long before — the anchor is lastHealthyAt, not firstProbeAt
    const d = decide(
      inputs({
        tldServers: { app: 'whois.nic.google' },
        rdapListedTlds: new Set(['app']),
        rdapHealthyTlds: new Set(['app']),
        ianaListsServer: { app: false },
        whoisState: {
          'whois.nic.google': record('dead-candidate', PHASEOUT_MIN_FAILURES + 5, {
            firstProbeAt: daysAgo(OLD_DAYS * 2),
            lastHealthyAt: daysAgo(YOUNG_DAYS),
          }),
        },
      })
    );
    expect(d.phaseout).toEqual([]); // YOUNG_DAYS < PHASEOUT_MIN_AGE_DAYS → not yet
    expect(d.candidates[0].deadDays).toBe(YOUNG_DAYS);
    expect(d.candidates[0].reason).toContain('dead only');
  });

  it('never phases out an overridden TLD, even when it otherwise qualifies', () => {
    const d = decide(
      inputs({
        tldServers: { dk: 'whois.punktum.dk' },
        rdapListedTlds: new Set(['dk']),
        rdapHealthyTlds: new Set(['dk']),
        ianaListsServer: { dk: false },
        whoisState: { 'whois.punktum.dk': record('dead-candidate', PHASEOUT_MIN_FAILURES + 1) },
        overriddenTlds: new Set(['dk']),
      })
    );
    expect(d.phaseout).toEqual([]);
    expect(d.candidates).toHaveLength(1);
    expect(d.candidates[0].reason).toContain('override');
  });

  it('never counts a suspect server toward a moat outage, even long-dead', () => {
    // a server returning empty/non-conformant responses is NOT connection-dead;
    // docs §5 tracks it separately, so it must not turn a no-RDAP TLD red
    const d = decide(
      inputs({
        tldServers: { xx: 'whois.nic.xx' },
        rdapListedTlds: new Set<string>(),
        rdapHealthyTlds: new Set<string>(), // no RDAP → would be a moat if it were dead
        ianaListsServer: { xx: false },
        whoisState: {
          'whois.nic.xx': record('suspect', PHASEOUT_MIN_FAILURES + 10, {
            detail: 'empty response',
          }),
        },
      })
    );
    expect(d.moatOutages).toEqual([]);
    expect(d.moatWatch).toEqual([]);
    expect(d.red).toBe(false);
    expect(d.unhealthyRoutes.map(u => u.tld)).toEqual(['xx']);
  });

  it('never phases out on suspect failures, even when the gate would otherwise pass', () => {
    const d = decide(
      inputs({
        tldServers: { app: 'whois.nic.google' },
        rdapListedTlds: new Set(['app']),
        rdapHealthyTlds: new Set(['app']),
        ianaListsServer: { app: false },
        whoisState: { 'whois.nic.google': record('suspect', PHASEOUT_MIN_FAILURES + 5) },
      })
    );
    expect(d.phaseout).toEqual([]);
    expect(d.candidates).toEqual([]); // suspect isn't a phase-out candidate either
    expect(d.unhealthyRoutes.map(u => u.tld)).toEqual(['app']);
  });

  it('phases out a server that refuses past the same gate, as after the gTLD sunset', () => {
    // Identity Digital answers `TLD is not supported.` for a TLD it took off port 43
    const d = decide(
      inputs({
        tldServers: { agency: 'whois.nic.agency' },
        rdapListedTlds: new Set(['agency']),
        rdapHealthyTlds: new Set(['agency']),
        ianaListsServer: { agency: false },
        whoisState: {
          'whois.nic.agency': record('refused', PHASEOUT_MIN_FAILURES, {
            probeQuery: 'nic.agency',
          }),
        },
      })
    );
    expect(d.phaseout).toEqual([
      {
        tld: 'agency',
        server: 'whois.nic.agency',
        consecutiveFailures: PHASEOUT_MIN_FAILURES,
        deadDays: OLD_DAYS,
      },
    ]);
    expect(d.red).toBe(false);
  });

  it('holds a refusing server as a candidate while a gate is unmet', () => {
    const refusing = (overrides: Partial<Parameters<typeof decide>[0]>) =>
      decide(
        inputs({
          tldServers: { agency: 'whois.nic.agency' },
          rdapListedTlds: new Set(['agency']),
          rdapHealthyTlds: new Set(['agency']),
          ianaListsServer: { agency: false },
          whoisState: {
            'whois.nic.agency': record('refused', PHASEOUT_MIN_FAILURES, {
              probeQuery: 'nic.agency',
            }),
          },
          ...overrides,
        })
      );

    const listed = refusing({ ianaListsServer: { agency: true } });
    expect(listed.phaseout).toEqual([]);
    expect(listed.candidates[0].reason).toContain('IANA still lists');

    const young = refusing({
      whoisState: {
        'whois.nic.agency': record('refused', PHASEOUT_MIN_FAILURES, {
          firstProbeAt: daysAgo(YOUNG_DAYS),
          probeQuery: 'nic.agency',
        }),
      },
    });
    expect(young.phaseout).toEqual([]);
    expect(young.candidates[0].reason).toContain('dead only');

    const few = refusing({
      whoisState: {
        'whois.nic.agency': record('refused', PHASEOUT_MIN_FAILURES - 1, {
          probeQuery: 'nic.agency',
        }),
      },
    });
    expect(few.phaseout).toEqual([]);
    expect(few.candidates[0].reason).toContain('failed probe');

    const rdapDown = refusing({ rdapHealthyTlds: new Set<string>() });
    expect(rdapDown.phaseout).toEqual([]);
    expect(rdapDown.candidates[0].reason).toBe('RDAP listed but unhealthy');
  });

  it('counts a refusal only for the TLD its probe asked about', () => {
    // a shared server that refused .info may still answer .bz
    const d = decide(
      inputs({
        tldServers: { info: 'whois.shared', bz: 'whois.shared' },
        rdapListedTlds: new Set(['info', 'bz']),
        rdapHealthyTlds: new Set(['info', 'bz']),
        ianaListsServer: { info: false, bz: false },
        whoisState: {
          'whois.shared': record('refused', PHASEOUT_MIN_FAILURES, { probeQuery: 'google.info' }),
        },
      })
    );
    expect(d.phaseout.map(p => p.tld)).toEqual(['info']);
    expect(d.candidates).toEqual([]);
    expect(d.unhealthyRoutes.map(u => u.tld)).toEqual(['bz', 'info']);
  });

  it('never counts a refusing server toward a moat outage', () => {
    const d = decide(
      inputs({
        tldServers: { xx: 'whois.nic.xx' },
        rdapListedTlds: new Set<string>(),
        rdapHealthyTlds: new Set<string>(),
        ianaListsServer: { xx: false },
        whoisState: {
          'whois.nic.xx': record('refused', PHASEOUT_MIN_FAILURES + 10, { probeQuery: 'nic.xx' }),
        },
      })
    );
    expect(d.phaseout).toEqual([]);
    expect(d.moatOutages).toEqual([]);
    expect(d.moatWatch).toEqual([]);
    expect(d.red).toBe(false);
    expect(d.unhealthyRoutes.map(u => u.tld)).toEqual(['xx']);
  });

  it('reports suspect/error routes as unhealthy without acting', () => {
    const d = decide(
      inputs({
        tldServers: { com: 'whois.verisign-grs.com', biz: 'whois.suspect' },
        rdapListedTlds: new Set(['com', 'biz']),
        rdapHealthyTlds: new Set(['com', 'biz']),
        ianaListsServer: { com: true, biz: true },
        whoisState: {
          'whois.verisign-grs.com': record('healthy', 0),
          'whois.suspect': record('suspect', 1, { detail: 'empty response' }),
        },
      })
    );
    expect(d.unhealthyRoutes).toEqual([
      { tld: 'biz', server: 'whois.suspect', classification: 'suspect', detail: 'empty response' },
    ]);
    expect(d.phaseout).toEqual([]);
    expect(d.red).toBe(false); // suspect alone is not red
  });

  it('skips servers not probed this run and TLDs already routed to null', () => {
    const d = decide(
      inputs({
        tldServers: { com: 'whois.verisign-grs.com', gone: null, unprobed: 'whois.unprobed' },
        rdapListedTlds: new Set(['com']),
        rdapHealthyTlds: new Set(['com']),
        ianaListsServer: {},
        whoisState: { 'whois.verisign-grs.com': record('healthy', 0) },
      })
    );
    expect(d.phaseout).toEqual([]);
    expect(d.candidates).toEqual([]);
    expect(d.moatOutages).toEqual([]);
  });

  describe('mergePhaseout', () => {
    const dec = (tld: string) => ({
      tld,
      server: `whois.nic.${tld}`,
      consecutiveFailures: 3,
      deadDays: 100,
    });

    it('unions prior entries with new decisions (never drops a prior phase-out)', () => {
      // the bug this guards: decide() skips already-nulled TLDs, so a run with no NEW
      // phase-outs must still keep the ones from prior runs — not reset the file to {}
      expect(mergePhaseout(['app', 'dev'], [], new Set())).toEqual({ app: null, dev: null });
      expect(mergePhaseout(['app'], [dec('zip')], new Set())).toEqual({ app: null, zip: null });
    });

    it('deduplicates a TLD present in both prior and new', () => {
      expect(mergePhaseout(['app'], [dec('app')], new Set())).toEqual({ app: null });
    });

    it('drops overridden TLDs (the override layer supersedes)', () => {
      expect(mergePhaseout(['app', 'dev'], [dec('zip')], new Set(['dev', 'zip']))).toEqual({
        app: null,
      });
    });

    it('returns a stably-sorted map', () => {
      expect(Object.keys(mergePhaseout(['zip', 'app', 'dev'], [], new Set()))).toEqual([
        'app',
        'dev',
        'zip',
      ]);
    });
  });

  it('evaluates each TLD independently when one server backs several', () => {
    // whois.shared serves .aa (has RDAP → phase-out) and .bb (no RDAP → moat). Dead
    // OLD_DAYS clears both the phase-out age gate and the moat-red window → .bb goes red.
    const d = decide(
      inputs({
        tldServers: { aa: 'whois.shared', bb: 'whois.shared' },
        rdapListedTlds: new Set(['aa']),
        rdapHealthyTlds: new Set(['aa']),
        ianaListsServer: { aa: false, bb: false },
        whoisState: { 'whois.shared': record('dead-candidate', PHASEOUT_MIN_FAILURES) },
      })
    );
    expect(d.phaseout.map(p => p.tld)).toEqual(['aa']);
    expect(d.moatOutages.map(m => m.tld)).toEqual(['bb']);
    expect(d.red).toBe(true);
  });
});
