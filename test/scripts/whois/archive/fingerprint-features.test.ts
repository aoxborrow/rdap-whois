import { describe, expect, it } from 'vitest';
// Unit tests for the P2 structural fingerprint extractor (docs/archive/whois-parser-refactor.md
// §6). These pin the marker rules and the labeled-block-vs-redacted-field discrimination —
// exactly the logic that silently rots as registries drift, and the thing a false marker
// would use to mis-assign a whole server's format.
import {
  fingerprint,
  signature,
  assignFormat,
  type Fingerprint,
} from '../../../../scripts/whois/archive/fingerprint-features';

// a canonical flat ICANN gTLD response (the 89% case)
const ICANN = `Domain Name: example.com
Registry Domain ID: 2336799_DOMAIN_COM-VRSN
Registrar WHOIS Server: whois.registrar.com
Updated Date: 2024-01-02T00:00:00Z
Creation Date: 2000-01-01T00:00:00Z
Registry Expiry Date: 2030-01-01T00:00:00Z
Registrar: Example Registrar
Registrar IANA ID: 123
Registrar Abuse Contact Email: abuse@registrar.com
Domain Status: clientTransferProhibited
Name Server: NS1.EXAMPLE.COM
Name Server: NS2.EXAMPLE.COM
DNSSEC: unsigned
>>> Last update of WHOIS database: 2024-01-02T00:00:00Z <<<`;

// a labeled-block ccTLD response: empty-value headers with INDENTED bodies (ati.tn / .il)
const LABELED = `Domain name: example.tn

Owner Contact:
   Name:         ACME Corp
   Address:      12 Main St
   City:         Tunis

Administrative contact:
   Name:         Jane Admin`;

// an RPSL / RIPE-database response
const RPSL = `% This is the .il whois server.

domain:       example.co.il
person:       Jane Doe
nic-hdl:      JD1-IL
mnt-by:       IL-MNT
source:       IL`;

// a FRED (CZ.NIC daemon) response — nsset/keyset object types are FRED-only
const FRED = `% (c) 2006-2024 CZ.NIC, z.s.p.o.

domain:       example.cz
registrant:   ACME
nsset:        NSSET-1
keyset:       KEYSET-1`;

// a CoCCA response: ICANN-shaped keys, but the CoCCA literal in the disclaimer
const COCCA = `Domain Name: example.gs
Registry Domain ID: 123-CoCCA
Name Server: ns1.example.gs

% This whois service is provided by CoCCA.`;

describe('fingerprint', () => {
  it('classifies a flat ICANN response as icann with many RA-spec keys', () => {
    const fp = fingerprint(ICANN);
    expect(fp.icannKeys).toBeGreaterThanOrEqual(5);
    expect(fp.labels).toBe('flat');
    expect(fp.markers).toEqual([]);
    expect(assignFormat(fp)).toBe('icann');
  });

  it('does NOT treat a redacted ICANN empty-value field as a section header', () => {
    // the bug the indentation check fixes: `... Email:` empty, next field flush-left
    const redacted = `Domain Name: example.com
Registry Domain ID: 1_COM-VRSN
Registrar Abuse Contact Email:
Registrar Abuse Contact Phone:
Name Server: ns1.example.com
Domain Status: ok
Creation Date: 2020-01-01T00:00:00Z`;
    expect(fingerprint(redacted).labels).toBe('flat');
  });

  it('detects indented section headers as labeled-blocks', () => {
    const fp = fingerprint(LABELED);
    expect(fp.labels).toBe('headers');
    expect(fp.icannKeys).toBeLessThan(3);
    expect(assignFormat(fp)).toBe('labeled-blocks');
  });

  it('detects the rpsl marker from nic-hdl and wins over icann keys', () => {
    const fp = fingerprint(RPSL);
    expect(fp.markers).toContain('rpsl');
    expect(fp.notice).toBe('none'); // a single leading % is not a block
    expect(assignFormat(fp)).toBe('rpsl');
  });

  it('detects the fred marker from nsset/keyset', () => {
    const fp = fingerprint(FRED);
    expect(fp.markers).toContain('fred');
    expect(assignFormat(fp)).toBe('fred');
  });

  it('detects the cocca marker from the disclaimer literal even on icann-shaped keys', () => {
    const fp = fingerprint(COCCA);
    expect(fp.markers).toContain('cocca');
    // marker wins the cascade over the ICANN-shaped keys
    expect(assignFormat(fp)).toBe('cocca');
  });

  it('classifies dotted-padding keys as the dotted separator style', () => {
    const dotted = `Domain Name......: example.ax
Name Server......: ns1.example.ax
Creation Date....: 2020-01-01`;
    expect(fingerprint(dotted).separator).toBe('dotted');
  });

  it('flags a block of leading % lines as pct notice style', () => {
    const withNotices = `% notice line one
% notice line two
% notice line three

domain: example.net`;
    expect(fingerprint(withNotices).notice).toBe('pct');
  });

  it('is total — never throws on empty or garbage input', () => {
    expect(() => fingerprint('')).not.toThrow();
    expect(() => fingerprint('\r\n\r\n')).not.toThrow();
    expect(() => fingerprint('no colons here at all\njust prose')).not.toThrow();
    expect(fingerprint('').markers).toEqual([]);
  });
});

describe('signature', () => {
  it('is stable and identical for structurally identical responses', () => {
    expect(signature(fingerprint(ICANN))).toBe(signature(fingerprint(ICANN)));
  });

  it('buckets icannKeys rather than exposing the raw count', () => {
    const hi = signature(fingerprint(ICANN));
    expect(hi).toContain('icannHi');
    expect(hi).not.toMatch(/icann\d{2,}/); // not a raw count like icann08
  });

  it('encodes operator markers into the signature', () => {
    expect(signature(fingerprint(RPSL))).toContain('m:rpsl');
    expect(signature(fingerprint(ICANN))).toContain('m:none');
  });
});

describe('assignFormat cascade priority', () => {
  it('prefers an operator marker over section headers and icann keys', () => {
    // synthetic: markers present AND headers AND many icann keys → marker still wins
    const fp: Fingerprint = {
      notice: 'pct',
      separator: 'colon',
      labels: 'headers',
      continuations: true,
      icannKeys: 8,
      blocks: '4+',
      markers: ['rpsl'],
    };
    expect(assignFormat(fp)).toBe('rpsl');
  });

  it('falls back to generic-kv when nothing else matches', () => {
    const fp: Fingerprint = {
      notice: 'none',
      separator: 'colon',
      labels: 'flat',
      continuations: false,
      icannKeys: 1,
      blocks: '1',
      markers: [],
    };
    expect(assignFormat(fp)).toBe('generic-kv');
  });
});
