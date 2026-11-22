import { describe, expect, it } from 'vitest';
import { FORMATS } from '../../src/whois/formats';
import type { WhoisFormat } from '../../src/whois/types';
import { compilePattern, expandCaseInsensitiveGroups } from '../../src/whois/regex';

// whether this engine reads `(?i:…)` itself (Node 23 and later), so the rewrite can be
// compared with the real thing
const native = (() => {
  try {
    new RegExp('(?i:a)');
    return true;
  } catch {
    return false;
  }
})();

const SAMPLES = [
  'NOT FOUND',
  'Not found: example.com',
  '%% not found...',
  'Domain example.com not found',
  'DOMAIN NOT FOUND',
  '"example.com" not found.',
  'No Objects Found',
  '%error 230 No Objects Found',
  'Status: AVAILABLE',
  'Nincs TALÁLAT',
  'nincs találat',
  '*** Nothing found for this query.',
  'Rate limit exceeded',
  '# Too many connections.',
  'Domain Name: example.com',
  'Registrar: Not Found Inc',
];

const patterns = Object.values(FORMATS as Record<string, WhoisFormat>).flatMap(format =>
  Object.values(format.meta ?? {}).flat()
);

describe('case-insensitive groups', () => {
  it('are rewritten into plain groups', () => {
    expect(expandCaseInsensitiveGroups('^\\s*(?i:no match)\\b')).toBe(
      '^\\s*(?:[nN][oO] [mM][aA][tT][cC][hH])\\b'
    );
    expect(expandCaseInsensitiveGroups('"[^"]+" (?i:not [a-c]x)')).toBe(
      '"[^"]+" (?:[nN][oO][tT] [a-cA-C][xX])'
    );
    // escapes and what follows the group keep their case
    expect(expandCaseInsensitiveGroups('(?i:\\S+\\.\\S+ no)\\.?End')).toBe(
      '(?:\\S+\\.\\S+ [nN][oO])\\.?End'
    );
  });

  it('compile on this engine, and every format pattern does', () => {
    expect(patterns.some(pattern => pattern.includes('(?i:'))).toBe(true);
    for (const pattern of patterns) expect(() => compilePattern(pattern, 'm')).not.toThrow();
  });

  it.runIf(native)('match what the modifier group matches', () => {
    for (const pattern of patterns) {
      const real = new RegExp(pattern, 'm');
      const rewritten = compilePattern(pattern, 'm');
      for (const sample of SAMPLES) {
        expect(rewritten.test(sample), `${pattern} on ${sample}`).toBe(real.test(sample));
      }
    }
  });
});
