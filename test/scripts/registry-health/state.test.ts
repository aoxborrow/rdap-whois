import { describe, expect, it } from 'vitest';
import { recordProbe, type ProbeRecord } from '../../../scripts/registry-health/state';

function run(classifications: ProbeRecord['classification'][]): number {
  const records: Record<string, ProbeRecord> = {};
  for (const classification of classifications) {
    recordProbe(records, 'whois.nic.example', { classification, probeQuery: 'nic.example' });
  }
  return records['whois.nic.example'].consecutiveFailures;
}

describe('recordProbe failure streaks', () => {
  it('counts connection failures and refusals as one streak', () => {
    expect(run(['dead-candidate', 'refused', 'dead-candidate', 'refused'])).toBe(4);
  });

  it('starts again when the failures change between evidence and odd answers', () => {
    expect(run(['suspect', 'suspect', 'suspect', 'refused'])).toBe(1);
    expect(run(['refused', 'refused', 'error'])).toBe(1);
    expect(run(['suspect', 'error', 'suspect'])).toBe(3);
  });

  it('resets on an alive answer', () => {
    expect(run(['refused', 'refused', 'throttled'])).toBe(0);
    expect(run(['refused', 'healthy', 'refused'])).toBe(1);
  });
});
