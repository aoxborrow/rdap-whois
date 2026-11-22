// cleanStatus normalizes the EPP status string the block engine pulls from a `Domain Status:`
// line. The old per-server regexes captured just the code; the new engine takes the whole value,
// so the shared cleaner must strip the registry's link/gloss (§6ai). These pin the forms the
// golden rebaseline surfaced.
import { describe, it, expect } from 'vitest';
import { cleanStatus } from '../../src/whois/utils';

describe('cleanStatus', () => {
  it('leaves a bare EPP code untouched', () => {
    expect(cleanStatus('clientTransferProhibited')).toBe('clientTransferProhibited');
    expect(cleanStatus('active')).toBe('active');
  });

  it('drops the ` - <url>` and the dangling separator (whois.1api.net)', () => {
    expect(
      cleanStatus('clientTransferProhibited - http://www.icann.org/epp#clientTransferProhibited')
    ).toBe('clientTransferProhibited');
  });

  it('drops a `-- <url>` double-separator (whois.pananames.com)', () => {
    expect(
      cleanStatus('clientTransferProhibited -- http://www.icann.org/epp#clientTransferProhibited')
    ).toBe('clientTransferProhibited');
  });

  it('extracts the code from a bare EPP link (whois.apiname.com)', () => {
    expect(cleanStatus('http://www.icann.org/epp#clientTransferProhibited')).toBe(
      'clientTransferProhibited'
    );
  });

  it('drops a ` - <gloss>` description (whois.nic.kz)', () => {
    expect(cleanStatus('ok - Normal state.')).toBe('ok');
    expect(
      cleanStatus('clientDeleteProhibited - status prevent domain deletion from the Register')
    ).toBe('clientDeleteProhibited');
  });

  it('strips a parenthesized url but keeps a multi-word registry status', () => {
    expect(
      cleanStatus('clientTransferProhibited (https://icann.org/epp#clientTransferProhibited)')
    ).toBe('clientTransferProhibited');
    expect(cleanStatus('Registered until cancelled')).toBe('Registered until cancelled');
  });

  it('returns null for empty input', () => {
    expect(cleanStatus('')).toBeNull();
    expect(cleanStatus(null)).toBeNull();
    expect(cleanStatus(undefined)).toBeNull();
  });
});
