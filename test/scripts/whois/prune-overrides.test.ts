import { describe, expect, it } from 'vitest';
import { computePrune } from '../../../scripts/whois/prune-overrides';

// a stand-in normalizer with the traits that matter: case-insensitive + trailing-slash
// insensitive (the real normalizeServer/normalizeRdapServer do more, but the comparison
// contract is the same)
const norm = (host: string): string => host.toLowerCase().replace(/\/+$/, '');

describe('computePrune', () => {
  it('removes an override the base layers already produce, keeps a deviating one', () => {
    const { pruned, removed } = computePrune(
      { redundant: 'whois.bar', deviates: 'whois.iana.org' },
      { redundant: 'whois.bar', deviates: 'whois.nic.example' },
      norm
    );
    expect(removed).toEqual([{ tld: 'redundant', value: 'whois.bar' }]);
    expect(pruned).toEqual({ deviates: 'whois.iana.org' });
  });

  it('treats null == null as redundant (a manual null the phase-out gate now produces)', () => {
    const { removed, pruned } = computePrune({ x: null }, { x: null }, norm);
    expect(removed).toEqual([{ tld: 'x', value: null }]);
    expect(pruned).toEqual({});
  });

  it('keeps a null override while the base still has a live server (still a real decision)', () => {
    const { removed, pruned } = computePrune({ x: null }, { x: 'whois.live' }, norm);
    expect(removed).toEqual([]);
    expect(pruned).toEqual({ x: null });
  });

  it('normalizes both sides before comparing', () => {
    const { removed } = computePrune({ x: 'WHOIS.BAR/' }, { x: 'whois.bar' }, norm);
    expect(removed).toEqual([{ tld: 'x', value: 'WHOIS.BAR/' }]);
  });

  it('keeps an override for a TLD the base does not cover at all', () => {
    const { removed, pruned } = computePrune({ x: 'whois.bar' }, {}, norm);
    expect(removed).toEqual([]);
    expect(pruned).toEqual({ x: 'whois.bar' });
  });
});
