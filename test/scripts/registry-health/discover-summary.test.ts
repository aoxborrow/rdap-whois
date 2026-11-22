import { describe, expect, it } from 'vitest';
import { summarizeBySource } from '../../../scripts/registry-health/discovery';

describe('summarizeBySource', () => {
  const names = ['debian', 'weppos'];

  it('counts candidates, verified-alive, and adopted per source', () => {
    const attempts = [
      { source: 'debian', candidate: true, alive: true }, // ga → adopted
      { source: 'weppos', candidate: true, alive: true }, // aco → adopted
      { source: 'weppos', candidate: true, alive: false }, // returned a dead candidate
    ];
    const adopted = { ga: 'debian', aco: 'weppos' };
    expect(summarizeBySource(names, attempts, adopted)).toEqual({
      debian: { candidates: 1, verifiedAlive: 1, adopted: 1 },
      weppos: { candidates: 2, verifiedAlive: 1, adopted: 1 },
    });
  });

  it('shows an unproductive source as all-zero (the "drop me" signal)', () => {
    // weppos returned candidates but none alive/adopted; a source that only echoes
    // another would sit at candidates>0, adopted:0 — or 0/0/0 if it returns nothing
    const attempts = [
      { source: 'debian', candidate: true, alive: true },
      { source: 'weppos', candidate: false, alive: false }, // source errored → not a candidate
    ];
    expect(summarizeBySource(names, attempts, { x: 'debian' })).toEqual({
      debian: { candidates: 1, verifiedAlive: 1, adopted: 1 },
      weppos: { candidates: 0, verifiedAlive: 0, adopted: 0 },
    });
  });

  it('ignores attempts from unknown sources and adopted entries with no known source', () => {
    const out = summarizeBySource(
      ['debian'],
      [{ source: 'mystery', candidate: true, alive: true }],
      { z: 'mystery' }
    );
    expect(out).toEqual({ debian: { candidates: 0, verifiedAlive: 0, adopted: 0 } });
  });
});
