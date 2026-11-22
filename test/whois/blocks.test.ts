// Unit tests for the blocks tokenizer + mapping pass (docs/archive/whois-parser-refactor.md
// §2). The A/B harness (whois:ab-parsers) is what proves the engine against the corpus;
// these pin the properties the corpus can't state directly — most importantly that the
// tokenizer is TOTAL (never throws, keeps unclaimed lines as leftovers) and that meta
// gates mapping.
import { describe, expect, it } from 'vitest';
import { tokenize } from '../../src/whois/blocks';
import { detectMeta, mapEntries, normalizeKey, parseBlocks } from '../../src/whois/mapping';
import { getFormat, type FormatName } from '../../src/whois/formats';
import { DOMAIN_QUERY_TYPE } from '../../src/common/constants';
import type { WhoisDomainData } from '../../src/whois/data-types';

const icann = getFormat('icann');
const genericKv = getFormat('generic-kv');

// parseBlocks returns the WhoisDataType union (same as the old engine's parse()); for a
// domain query it is WhoisDomainData. Narrow once here rather than at every assertion.
function parseDomain(raw: string, format: FormatName, server = 'whois.example') {
  const result = parseBlocks(raw, server, DOMAIN_QUERY_TYPE, format);
  return { ...result, data: result.data as WhoisDomainData };
}

describe('blocks: tokenize', () => {
  it('splits key/value entries and records line provenance', () => {
    const blocks = tokenize('Domain Name: example.com\nRegistrar: Example Inc.');
    expect(blocks.blocks).toHaveLength(1);
    expect(blocks.blocks[0].entries).toEqual([
      { key: 'Domain Name', value: 'example.com', line: 1 },
      { key: 'Registrar', value: 'Example Inc.', line: 2 },
    ]);
  });

  it('splits on the FIRST colon so URLs and timestamps survive in values', () => {
    const blocks = tokenize(
      'Registrar URL: http://example.com/a:b\nUpdated Date: 2024-01-02T03:04:05Z'
    );
    expect(blocks.blocks[0].entries[0].value).toBe('http://example.com/a:b');
    expect(blocks.blocks[0].entries[1].value).toBe('2024-01-02T03:04:05Z');
  });

  it('normalizes \\r\\n before tokenizing (§2)', () => {
    const blocks = tokenize('Domain Name: example.com\r\nRegistrar: Example Inc.\r\n');
    expect(blocks.blocks[0].entries.map(e => e.value)).toEqual(['example.com', 'Example Inc.']);
  });

  it('preserves repeated keys in order (§2)', () => {
    const blocks = tokenize('Name Server: b.example.com\nName Server: a.example.com');
    expect(blocks.blocks[0].entries.map(e => e.value)).toEqual(['b.example.com', 'a.example.com']);
  });

  it('splits blocks on blank lines', () => {
    const blocks = tokenize(
      'Domain Name: example.com\n\nRegistrant Name: Ada\nRegistrant City: Rome'
    );
    expect(blocks.blocks).toHaveLength(2);
    expect(blocks.blocks[1].entries).toHaveLength(2);
  });

  it('captures %/#/>>> lines as notices, never as data', () => {
    const blocks = tokenize(
      '% this is a notice\n# so is this\n>>> Last update: now <<<\nDomain Name: example.com'
    );
    expect(blocks.notices).toHaveLength(3);
    expect(blocks.blocks[0].entries).toEqual([
      { key: 'Domain Name', value: 'example.com', line: 4 },
    ]);
  });

  it('folds bare continuation lines into the previous value (the CoCCA address case, §1)', () => {
    const blocks = tokenize(
      'Registrar Street Address: 1120 S. Rackham Way, Suite 300\nMeridian, Idaho\n83642\nRegistrar Country: US'
    );
    expect(blocks.blocks[0].entries[0].value).toBe(
      '1120 S. Rackham Way, Suite 300\nMeridian, Idaho\n83642'
    );
    expect(blocks.blocks[0].entries[1]).toEqual({ key: 'Registrar Country', value: 'US', line: 4 });
  });

  it('does not fold prose across a blank line into the last field', () => {
    const blocks = tokenize('Domain Name: example.com\n\nsome trailing legal prose');
    expect(blocks.blocks[0].entries[0].value).toBe('example.com');
    expect(blocks.leftovers).toEqual([{ text: 'some trailing legal prose', line: 3 }]);
  });

  it('is TOTAL: never throws, and keeps unclaimed lines as leftovers (§2)', () => {
    for (const input of [
      '',
      '   ',
      'no colons here at all',
      ':',
      '::::',
      '\n\n\n',
      'x'.repeat(5000),
    ]) {
      expect(() => tokenize(input)).not.toThrow();
    }
    expect(tokenize('a line with no key').leftovers).toHaveLength(1);
  });

  it('treats over-long prose keys as leftovers rather than bogus entries', () => {
    const prose =
      'By submitting this query you agree to the terms and conditions of this service: see the URL';
    expect(tokenize(prose).blocks).toHaveLength(0);
    expect(tokenize(prose).leftovers).toHaveLength(1);
  });

  it('reads an empty value as an empty entry by default, not a block label', () => {
    // ICANN writes redacted fields as `Key:` — that must not open a section
    const blocks = tokenize('Registrar Abuse Contact Email:\nRegistrar Country: US');
    expect(blocks.blocks[0].entries[0]).toEqual({
      key: 'Registrar Abuse Contact Email',
      value: '',
      line: 1,
    });
    expect(blocks.blocks[0].label).toBeUndefined();
  });

  it('opens a labeled block on an empty value when the format asks for it', () => {
    const blocks = tokenize('Owner Contact:\nName: Ada\nCity: Rome', {
      blockLabels: 'empty-value',
    });
    expect(blocks.blocks[0].label).toBe('Owner Contact');
    expect(blocks.blocks[0].entries).toHaveLength(2);
  });

  it('keeps a bodyless value-header block at EOF (no trailing blank line)', () => {
    // an enumerated header carrying a value as the LAST line must still be pushed — the EOF
    // flush guards on labelValue, not just entries.length (PR #379 review finding)
    const blocks = tokenize('Domain Name: example.com\nAdministrative contact: Individual', {
      sectionHeaders: ['Administrative contact'],
    });
    const labeled = blocks.blocks.find(b => b.label === 'Administrative contact');
    expect(labeled).toBeDefined();
    expect(labeled?.labelValue).toBe('Individual');
  });
});

describe('mapping: normalizeKey', () => {
  it('is case-insensitive and strips the .ax dot padding (§9b)', () => {
    expect(normalizeKey('Registrar WHOIS Server')).toBe(normalizeKey('registrar whois server'));
    expect(normalizeKey('domain...............')).toBe('domain');
    expect(normalizeKey('  Name   Server  ')).toBe('name server');
  });
});

describe('mapping: alias tables', () => {
  it('maps fully-qualified icann keys to canonical fields', () => {
    const { parsed } = mapEntries(
      tokenize('Registrant Email: a@b.com\nRegistry Domain ID: X-1'),
      icann
    );
    expect(parsed.registrantEmail).toBe('a@b.com');
    expect(parsed.domainId).toBe('X-1');
  });

  it('keeps contact roles apart — the cross-section-bleed case the rewrite targets (§1)', () => {
    const { parsed } = mapEntries(
      tokenize('Registrant Name: Ada\nAdmin Name: Bob\nTech Name: Cy\nBilling Name: Dee'),
      icann
    );
    expect(parsed.registrantName).toBe('Ada');
    expect(parsed.adminName).toBe('Bob');
    expect(parsed.techName).toBe('Cy');
    expect(parsed.billingName).toBe('Dee');
  });

  it('collision rule: the earlier alias wins regardless of document order (§2)', () => {
    // CoCCA sends both, and they can disagree — the REGISTRY expiry must win
    const source =
      'Registrar Registration Expiration Date: 2030-01-01T00:00:00Z\nRegistry Expiry Date: 2025-07-29T18:15:42Z';
    const { parsed, unmapped } = mapEntries(tokenize(source), icann);
    expect(parsed.expirationDate).toBe('2025-07-29T18:15:42Z');
    // the loser is surfaced as drift, not dropped silently
    expect(unmapped.map(e => e.key)).toContain('Registrar Registration Expiration Date');
  });

  it('reports keys it does not understand as unmapped — the §5 drift signal', () => {
    const { unmapped } = mapEntries(
      tokenize('Domain Name: example.com\nSome Unknown Key: value'),
      icann
    );
    expect(unmapped.map(e => e.key)).toEqual(['Some Unknown Key']);
  });

  it('an understood key with an empty value is not drift', () => {
    const { parsed, unmapped } = mapEntries(tokenize('Registrar Abuse Contact Email:'), icann);
    expect(unmapped).toHaveLength(0);
    expect(parsed.registrarAbuseEmail).toBeUndefined();
  });

  it('generic-kv picks up the non-icann tail (nserver/created/person)', () => {
    const { parsed } = mapEntries(
      tokenize('domain: example.cz\nnserver: a.ns.cz\ncreated: 2010-01-01'),
      genericKv
    );
    expect(parsed.domainName).toBe('example.cz');
    expect(parsed.nameservers).toEqual(['a.ns.cz']);
    expect(parsed.creationDate).toBe('2010-01-01');
  });

  it('generic-kv adopts the corpus-mined aliases (P3, mined-aliases.ts)', () => {
    const { parsed } = mapEntries(
      tokenize(
        'Website: https://reg.example\n' +
          'Sponsoring Registrar Country: ID\n' +
          'Registrant Contact ID: R-123\n' +
          'Tech Contact ID: C-456\n' +
          'Registrant Ext. Country: US\n' +
          'Registrant Ext. Organization: Google LLC'
      ),
      genericKv
    );
    expect(parsed.registrarUrl).toBe('https://reg.example');
    expect(parsed.registrarCountry).toBe('ID');
    expect(parsed.registrantId).toBe('R-123');
    expect(parsed.techId).toBe('C-456');
    expect(parsed.registrantCountry).toBe('US');
    expect(parsed.registrantOrg).toBe('Google LLC');
  });

  it('a mined alias ranks LAST — the canonical spelling still wins the collision (§2)', () => {
    // `Registrar URL` (icann) must beat the mined `Website` for registrarUrl
    const { parsed, unmapped } = mapEntries(
      tokenize('Registrar URL: https://canonical\nWebsite: https://mined'),
      genericKv
    );
    expect(parsed.registrarUrl).toBe('https://canonical');
    expect(unmapped.map(e => e.key)).toContain('Website');
  });
});

describe('mapping: anchored meta (§4)', () => {
  it('detects notfound only when ANCHORED at the start of a line', () => {
    expect(detectMeta('No match for "EXAMPLE.COM".', icann).notfound).toBeTruthy();
    // the old engine's substring match fired on boilerplate like this — the whole bug
    // (docs/archive/tool-improvements.md); the anchored pattern must not
    const boilerplate =
      'Domain Name: example.com\nNOTICE: if the domain is not found in our database, the query returns no match for it.';
    expect(detectMeta(boilerplate, icann).notfound).toBeUndefined();
  });

  it('models servfail separately from throttled (§4)', () => {
    // observed live in the P0 sweep: Identity Digital answering for a TLD it doesn't serve
    expect(detectMeta('TLD is not supported.', icann).servfail).toBeTruthy();
    expect(detectMeta('TLD is not supported.', icann).notfound).toBeUndefined();
  });

  it("classifies FRED's connection-limit page as throttled, never notfound (§4)", () => {
    // FRED's rate-limit reply (the whois.nic.cz throttled fixture, verbatim) — as
    // notfound it would render the domain "available" and skip the retry path
    const fred = getFormat('fred');
    const limited = 'Your connection limit exceeded. Please slow down and try again later.';
    expect(detectMeta(limited, fred).throttled).toBeTruthy();
    expect(detectMeta(limited, fred).notfound).toBeUndefined();
    // the `%`-commented spelling some FRED registries use
    expect(detectMeta('% Your connection limit exceeded', fred).throttled).toBeTruthy();
  });

  it('meta GATES mapping: an error page never yields data fields (§4)', () => {
    const throttled = 'Rate limit exceeded. Try again later.\nDomain Name: example.com';
    const result = parseDomain(throttled, 'icann');
    expect(result.status).toBe('throttled');
    // the response mentions a domain, but a throttle page's "data" is garbage
    expect(result.data.domainName).toBeNull();
  });

  it('does not gate on notfound — its absent fields are the point', () => {
    const result = parseDomain('No match for "EXAMPLE.COM".', 'icann');
    expect(result.status).toBe('notfound');
    expect(result.data).toBeTruthy();
  });
});

describe('mapping: parseBlocks output contract', () => {
  const response = [
    'Domain Name: EXAMPLE.COM',
    '   Registry Domain ID: 123_DOMAIN_COM-VRSN',
    '   Registrar: Example Registrar, Inc.',
    '   Registrar IANA ID: 292',
    '   Updated Date: 2019-09-09T15:39:04Z',
    '   Name Server: NS2.EXAMPLE.COM',
    '   Name Server: NS1.EXAMPLE.COM',
    '   DNSSEC: unsigned',
  ].join('\n');

  it('produces the canonical contract, formatted by the SAME base.ts formatters', () => {
    const { data } = parseDomain(response, 'icann', 'whois.verisign-grs.com');
    // domainName lowercased by singleDomainFormatter; dates via dateFormatter;
    // nameservers cleaned + natural-sorted by nameserverFormatter
    expect(data.domainName).toBe('example.com');
    expect(data.updatedDate).toEqual(new Date('2019-09-09T15:39:04Z'));
    expect(data.nameservers).toEqual(['ns1.example.com', 'ns2.example.com']);
    expect(data.registrarId).toBe('292');
  });

  it('nulls required fields the response omits, like the old engine', () => {
    const { data } = parseDomain(response, 'icann', 'whois.verisign-grs.com');
    expect(data.expirationDate).toBeNull();
    expect(data.registrarUrl).toBeNull();
  });

  it('a folded continuation resolves to its first line for single-value fields', () => {
    // .moscow continues an abuse phone onto a bare line; .gh writes a bare `Additional
    // Section` header under DNSSEC. Both must resolve to the first line, not a glued string.
    const source =
      'Registrar Abuse Contact Phone: +7 495 7370683\n+7 495 7370742\nDNSSEC: unsigned\nAdditional Section';
    const { data } = parseDomain(source, 'icann');
    expect(data.registrarAbusePhone).toBe('+7 495 7370683');
    expect(data.dnssecRaw).toBe('unsigned');
    expect(data.dnssec).toBe(false);
  });
});
