// P3b: scoped role resolution (docs/archive/whois-parser-refactor.md §2/§6f). Unit coverage for the
// two new engine capabilities the operator formats need — role/field-from-block-label
// (labeled-blocks) and handle-reference role resolution (rpsl/fred) — plus the tokenizer's
// bare-value capture that block-label mapping depends on. Small synthetic inputs, so a
// failure points at the mechanism, not a fixture quirk.
import { describe, it, expect } from 'vitest';
import { DOMAIN_QUERY_TYPE } from '../../src/common/constants';
import { tokenize } from '../../src/whois/blocks';
import { parseBlocks, mapEntries, normalizeKey } from '../../src/whois/mapping';
import { deriveFormat, resolveFormat } from '../../src/whois/formats';

const parse = (raw: string, format: any) =>
  parseBlocks(raw, 'test.server', DOMAIN_QUERY_TYPE, format).data as any;

describe('tokenizer: bare-value capture (empty-value mode)', () => {
  it('captures bare lines under a section header as keyless entries', () => {
    const raw = ['Name servers:', '        ns1.example.com', '        ns2.example.com'].join('\n');
    const { blocks } = tokenize(raw, { blockLabels: 'empty-value', foldContinuations: false });
    expect(blocks).toHaveLength(1);
    expect(blocks[0].label).toBe('Name servers');
    expect(blocks[0].entries.map(e => e.value)).toEqual(['ns1.example.com', 'ns2.example.com']);
    expect(blocks[0].entries.every(e => e.key === '')).toBe(true);
  });

  it('does NOT capture bare values in the default (none) mode — they stay leftovers', () => {
    const raw = ['some prose with no colon'].join('\n');
    const { leftovers, blocks } = tokenize(raw, { blockLabels: 'none' });
    expect(blocks).toHaveLength(0);
    expect(leftovers).toHaveLength(1);
  });
});

describe('block-label resolution (labeled-blocks)', () => {
  it('maps section headers to scope/field and role-less sub-KVs to <scope>_<suffix>', () => {
    const raw = [
      'Domain: example.eu',
      '',
      'Registrant:',
      '        NOT DISCLOSED!',
      '',
      'Registrar:',
      '        Name: Example Registrar Inc.',
      '        Website: https://registrar.example',
      '',
      'Name servers:',
      '        ns1.example.com',
      '        ns2.example.com',
    ].join('\n');
    const d = parse(raw, 'labeled-blocks');
    expect(d.domainName).toBe('example.eu');
    // a bare value under a contact header becomes <scope>_name
    expect(d.registrantName).toBe('NOT DISCLOSED!');
    // sub-KVs under a scoped header resolve via SCOPE_ALIASES
    expect(d.registrarName).toBe('Example Registrar Inc.');
    expect(d.registrarUrl).toBe('https://registrar.example');
    // a bare-value list maps to the block's whole-block field
    expect(d.nameservers).toEqual(['ns1.example.com', 'ns2.example.com']);
  });

  it('resolves scope-less date sections via the domain-level aliases', () => {
    const raw = [
      'Domain name:',
      '        example.uk',
      '',
      '    Relevant dates:',
      '        Registered on: 01-Aug-2010',
      '        Expiry date: 01-Aug-2026',
    ].join('\n');
    const d = parse(raw, 'labeled-blocks');
    expect(d.domainName).toBe('example.uk');
    expect(d.creationDate).toEqual(new Date('2010-08-01T00:00:00Z'));
    expect(d.expirationDate).toEqual(new Date('2026-08-01T00:00:00Z'));
  });
});

describe('handle-ref resolution (rpsl)', () => {
  it('resolves holder-c/admin-c/tech-c references to the matching nic-hdl blocks', () => {
    const raw = [
      'domain:      example.fr',
      'holder-c:    HOLD-FR',
      'tech-c:      TECH-FR',
      'nserver:     ns1.example.fr',
      'created:     2001-02-03T00:00:00Z',
      '',
      'nic-hdl:     HOLD-FR',
      'contact:     Example Holder',
      'address:     1 rue Example',
      'country:     FR',
      'e-mail:      holder@example.fr',
      '',
      'nic-hdl:     TECH-FR',
      'contact:     Example Tech',
      'e-mail:      tech@example.fr',
    ].join('\n');
    const d = parse(raw, 'rpsl');
    expect(d.domainName).toBe('example.fr');
    expect(d.nameservers).toEqual(['ns1.example.fr']);
    // the domain-block reference banks the id; the nic-hdl block supplies the rest
    expect(d.registrantId).toBe('HOLD-FR');
    expect(d.registrantName).toBe('Example Holder');
    expect(d.registrantAddress).toEqual(['1 rue Example']);
    expect(d.registrantCountry).toBe('FR');
    expect(d.registrantEmail).toBe('holder@example.fr');
    // tech resolved independently from its own block
    expect(d.techName).toBe('Example Tech');
    expect(d.techEmail).toBe('tech@example.fr');
    // a registrant's contact fields must NOT leak into the tech (scope isolation)
    expect(d.techCountry).toBeFalsy();
  });
});

describe('handle-ref resolution (fred)', () => {
  it('resolves registrant/admin-c references and parses day-first dotted dates', () => {
    const raw = [
      'domain:      example.cz',
      'registrant:  REG-CZ',
      'registered:  21.07.2000 15:21:00',
      'expire:      22.07.2025',
      '',
      'contact:     REG-CZ',
      'org:         Example Org',
      'name:        Example Person',
      'address:     1 Example St',
    ].join('\n');
    const d = parse(raw, 'fred');
    expect(d.domainName).toBe('example.cz');
    // day-first: 21.07.2000 is 21 July, not an invalid 7th-of-month-21
    expect(d.creationDate).toEqual(new Date('2000-07-21T15:21:00Z'));
    expect(d.registrantId).toBe('REG-CZ');
    expect(d.registrantOrg).toBe('Example Org');
    expect(d.registrantName).toBe('Example Person');
    // `contact:` is the block handle, not a name — it must not overwrite `name:`
    expect(d.registrantName).not.toBe('REG-CZ');
    expect(d.registrantAddress).toEqual(['1 Example St']);
  });
});

describe('per-server config layer (P4a)', () => {
  it('deriveFormat merges per-server aliases with HIGHEST priority (collision rule)', () => {
    const f = deriveFormat({ format: 'generic-kv', aliases: { registrarName: ['Sponsor'] } });
    // the per-server spelling is present AND ranks ahead of the base spellings
    expect(f.aliases.registrarName[0]).toBe('Sponsor');
    expect(f.aliases.registrarName).toContain('Registrar');
  });

  it('resolveFormat: per-server config wins over an explicit format name (§2 order)', () => {
    // whois.nic.kz has a config → resolveFormat ignores the passed name and derives it
    const viaConfig = resolveFormat('whois.nic.kz', 'icann');
    expect(viaConfig.aliases.nameservers).toContain('Primary server');
    // an unconfigured server falls through to the explicit name
    expect(resolveFormat('unconfigured.example', 'icann').name).toBe('icann');
  });

  it('applies a per-server alias override end-to-end', () => {
    const raw = ['Domain Name: example.kz', 'Primary server: ns1.example.kz'].join('\n');
    // no format passed — resolveFormat picks up whois.nic.kz's config
    const d = parseBlocks(raw, 'whois.nic.kz', DOMAIN_QUERY_TYPE).data as any;
    expect(d.domainName).toBe('example.kz');
    expect(d.nameservers).toEqual(['ns1.example.kz']);
  });

  it('converts a hyphenated role-subfield block (.st) via config aliases', () => {
    const raw = [
      'Domain Name: example.st',
      'created-date: 2004-06-15 18:24:45',
      'registrant-organization: Example Org',
      'registrant-name: Example Person',
      'registrant-street: 1 Example St',
      'admin-name: Admin Person',
      'tech-email: tech@example.st',
    ].join('\n');
    const d = parseBlocks(raw, 'whois.nic.st', DOMAIN_QUERY_TYPE).data as any;
    expect(d.creationDate).toEqual(new Date('2004-06-15T18:24:45Z'));
    expect(d.registrantOrg).toBe('Example Org');
    expect(d.registrantName).toBe('Example Person');
    expect(d.registrantAddress).toEqual(['1 Example St']);
    // role isolation: admin/tech land in their own scope, not the registrant's
    expect(d.adminName).toBe('Admin Person');
    expect(d.techEmail).toBe('tech@example.st');
  });
});

describe('colon-less section headers (kaznic, P4b)', () => {
  it('opens blocks on declared colon-less headers and scopes their dot-padded sub-KVs', () => {
    const raw = [
      'Domain Name............: example.kz',
      '',
      'Whois Server prose line that is NOT a header',
      '',
      'Organization Using Domain Name',
      'Name...................: Example Person',
      'Organization Name......: Example LLC',
      'Street Address.........: 1 Example St',
      'Country................: KZ',
      '',
      'Administrative Contact/Agent',
      'NIC Handle.............: EX-42',
      'Name...................: Admin Person',
      'Phone Number...........: +7700000000',
      'Email Address..........: admin@example.kz',
      '',
      'Nameserver in listed order',
      '',
      'Primary server.........: ns1.example.kz',
      'Secondary server.......: ns2.example.kz',
      '',
      'Domain created: 2004-10-19 09:01:55 (GMT+0:00)',
      'Current Registar: EXAMPLE.KZ',
    ].join('\n');
    const d = parse(raw, 'kaznic');
    // domain-level fields map from the un-headed blocks
    expect(d.domainName).toBe('example.kz');
    expect(d.creationDate).toEqual(new Date('2004-10-19T09:01:55Z'));
    expect(d.nameservers).toEqual(['ns1.example.kz', 'ns2.example.kz']);
    expect(d.registrarName).toBe('EXAMPLE.KZ');
    // registrant from the first colon-less header; dot-padded keys strip to the base name
    expect(d.registrantName).toBe('Example Person');
    expect(d.registrantOrg).toBe('Example LLC');
    expect(d.registrantAddress).toEqual(['1 Example St']);
    expect(d.registrantCountry).toBe('KZ');
    // admin scoped independently; NIC Handle → adminId (scopeAliases id override)
    expect(d.adminId).toBe('EX-42');
    expect(d.adminName).toBe('Admin Person');
    expect(d.adminPhone).toBe('+7700000000');
    expect(d.adminEmail).toBe('admin@example.kz');
    // scope isolation: the registrant's name must not leak into admin or vice-versa
    expect(d.registrantName).not.toBe('Admin Person');
    // a prose line that isn't a declared header never becomes a section/field
    expect(d.registrantOrg).not.toBe('Whois Server prose line that is NOT a header');
  });

  it('leaves colon-less headers off for non-kaznic formats (no false sections)', () => {
    const { blocks } = tokenize(['Administrative Contact/Agent', 'Name: X'].join('\n'), {});
    // generic tokenizer: the colon-less line is a leftover, not a block label
    expect(blocks.every(b => b.label !== 'Administrative Contact/Agent')).toBe(true);
  });
});

describe('block-scoped base via per-server config (P4b §6l)', () => {
  it('drives colon-less Spanish headers from config sectionHeaders (.bo shape)', () => {
    const raw = [
      'NOMBRE DE DOMINIO: example.bo',
      'TITULAR DEL DOMINIO',
      'Nombre Completo / Representante legal: Example LLC',
      'Correo electrónico: reg@example.bo',
      'País: Bolivia',
      'CONTACTO TECNICO',
      'Razón social: Tech Co',
      'Nombre Completo: Tech Person',
      'Correo electrónico: tech@example.bo',
      'Fecha de activación: 2019-01-15',
    ].join('\n');
    const d = parseBlocks(raw, 'whois.nic.bo', DOMAIN_QUERY_TYPE).data as any;
    expect(d.domainName).toBe('example.bo');
    expect(d.creationDate).toEqual(new Date('2019-01-15T00:00:00Z'));
    expect(d.registrantName).toBe('Example LLC');
    expect(d.registrantEmail).toBe('reg@example.bo');
    expect(d.registrantCountry).toBe('Bolivia');
    // tech scoped independently; org from `Razón social`, name from `Nombre Completo`
    expect(d.techOrg).toBe('Tech Co');
    expect(d.techName).toBe('Tech Person');
    expect(d.techEmail).toBe('tech@example.bo');
    // isolation: the registrant's contact must not leak into tech
    expect(d.techCountry).toBeFalsy();
  });

  it('drives [Bracket] French headers + ID Contact→scope_id from config (.sn shape)', () => {
    const raw = [
      'Domain ID: DOM-1-SN',
      'Nom de domaine: example.sn',
      "Date d'expiration: 2025-12-31T12:00:00Z",
      '[HOLDER]',
      'ID Contact: EX1',
      'Nom: Example Org',
      'Adresse: 1 rue Example',
      'Courriel: holder@example.sn',
      '[TECH_C]',
      'ID Contact: EX2',
      'Nom: Tech Org',
      'Courriel: tech@example.sn',
    ].join('\n');
    const d = parseBlocks(raw, 'whois.nic.sn', DOMAIN_QUERY_TYPE).data as any;
    expect(d.domainId).toBe('DOM-1-SN');
    expect(d.domainName).toBe('example.sn');
    expect(d.expirationDate).toEqual(new Date('2025-12-31T12:00:00Z'));
    // bracket header → scope; `ID Contact` → <scope>_id
    expect(d.registrantId).toBe('EX1');
    expect(d.registrantName).toBe('Example Org');
    expect(d.registrantAddress).toEqual(['1 rue Example']);
    expect(d.registrantEmail).toBe('holder@example.sn');
    expect(d.techId).toBe('EX2');
    expect(d.techName).toBe('Tech Org');
    expect(d.techEmail).toBe('tech@example.sn');
    // the holder's address must not leak into tech (scope isolation)
    expect(d.techAddress).not.toEqual(['1 rue Example']);
  });
});

describe('enumerated colon-carrying headers + blank-line tolerance (block-scoped, P4b §6m)', () => {
  // The kg/bnnic keyed-body shape: a `Contact:` header (keeps its colon), a blank line, then
  // `Key: value` sub-fields — with redacted EMPTY fields (`Name:`) that must NOT hijack the
  // block the way blanket empty-value mode would. Only enumerated headers open blocks.
  const kgLike = [
    'Domain EXAMPLE.KG (ACTIVE)',
    '',
    'Administrative Contact:',
    '',
    '   PID: AI-1-KG',
    '   Name: ', // redacted empty field — must stay an entry, not open a block
    '   Email: admin@example.kg',
    '   phone: +49-1',
    '',
    'Technical Contact:',
    '',
    '   PID: TE-2-KG',
    '   Email: tech@example.kg',
    '',
    'Name servers in the listed order:',
    '',
    'NS1.EXAMPLE.KG',
    'NS2.EXAMPLE.KG',
  ].join('\n');
  const config = {
    format: 'block-scoped' as const,
    blankLinesInBlocks: true,
    sectionHeaders: [
      'Administrative Contact',
      'Technical Contact',
      'Name servers in the listed order',
    ],
    blockScopes: { 'administrative contact': 'admin', 'technical contact': 'tech' } as any,
    blockFields: { 'name servers in the listed order': 'nameservers' },
    scopeAliases: { id: ['PID'] },
  };

  it('opens blocks only on enumerated headers; a redacted empty field does not hijack', () => {
    const format = deriveFormat(config);
    const blocks = tokenize(kgLike, format.tokenizer);
    // three enumerated blocks open (admin, tech, NS) — the empty `Name:` did NOT open one,
    // and the leading positional `Domain …` line is an unlabeled block
    const labels = blocks.blocks.map(b => b.label);
    expect(labels).toContain('Administrative Contact');
    expect(labels).toContain('Technical Contact');
    expect(labels).not.toContain('Name'); // redacted empty field stayed an entry
    // the empty Name field is an entry inside the admin block, not a boundary
    const admin = blocks.blocks.find(b => b.label === 'Administrative Contact')!;
    expect(admin.entries.some(e => normalizeKey(e.key) === 'name' && !e.value)).toBe(true);
    expect(admin.entries.some(e => normalizeKey(e.key) === 'email')).toBe(true);
  });

  it('scopes fields across the header→blank→fields gap and captures the bare NS list', () => {
    const format = deriveFormat(config);
    const blocks = tokenize(kgLike, format.tokenizer);
    const { parsed } = mapEntries(blocks, format) as any;
    expect(parsed.adminId).toBe('AI-1-KG');
    expect(parsed.adminEmail).toBe('admin@example.kg');
    expect(parsed.adminPhone).toBe('+49-1');
    // the empty `Name:` did not open a block, so tech fields still resolve
    expect(parsed.techId).toBe('TE-2-KG');
    expect(parsed.techEmail).toBe('tech@example.kg');
    // bare hostnames under the enumerated list header are captured
    expect(parsed.nameservers).toEqual(['NS1.EXAMPLE.KG', 'NS2.EXAMPLE.KG']);
  });
});

describe('value-carrying enumerated headers (headerValueSuffix, P4b §6m)', () => {
  it('routes a header line value to <scope>_<suffix> (name) and scopes the sub-fields', () => {
    const raw = [
      'Registrant: Ringier Serbia doo',
      'Address: Kosovska 10',
      'Postal Code: 11000',
      'Technical contact: Mainstream d.o.o.',
      'Address: Nusiceva 15',
    ].join('\n');
    const format = deriveFormat({
      format: 'block-scoped',
      sectionHeaders: ['Registrant', 'Technical contact'],
      blockScopes: { 'registrant': 'registrant', 'technical contact': 'tech' } as any,
      headerValueSuffix: 'name',
    });
    const { parsed } = mapEntries(tokenize(raw, format.tokenizer), format) as any;
    expect(parsed.registrantName).toBe('Ringier Serbia doo');
    expect(parsed.registrantPostalCode).toBe('11000');
    expect(parsed.techName).toBe('Mainstream d.o.o.');
    // scope isolation — registrant address must not bleed into tech
    expect(parsed.techAddress).toEqual(['Nusiceva 15']);
  });

  it('routes a header value to id when the header states a handle, name comes from Name:', () => {
    const raw = ['Domain registrant: WY-237559', 'Name: Igor Strecko', 'Country Code: SK'].join(
      '\n'
    );
    const format = deriveFormat({
      format: 'block-scoped',
      sectionHeaders: ['Domain registrant'],
      blockScopes: { 'domain registrant': 'registrant' } as any,
      headerValueSuffix: 'id',
      scopeAliases: { country: ['Country Code'] },
    });
    const { parsed } = mapEntries(tokenize(raw, format.tokenizer), format) as any;
    expect(parsed.registrantId).toBe('WY-237559');
    expect(parsed.registrantName).toBe('Igor Strecko');
    expect(parsed.registrantCountry).toBe('SK');
  });
});

describe('multispace key/value split (keyValueSplit, P4b §6n)', () => {
  it('splits column-aligned colon-less lines on the first 2+ space run', () => {
    const raw = [
      'a. [Domain Name]                GOOGLE.CO.JP',
      'p. [Name Server]     ns1.g.com',
    ].join('\n');
    const { blocks } = tokenize(raw, { keyValueSplit: 'multispace', foldContinuations: false });
    const entries = blocks.flatMap(b => b.entries);
    expect(entries.map(e => [e.key, e.value])).toEqual([
      ['a. [Domain Name]', 'GOOGLE.CO.JP'],
      ['p. [Name Server]', 'ns1.g.com'],
    ]);
  });
});

describe('positional templates (bare lines by position, P4p §6p)', () => {
  it('maps header value + bare lines by position, extracts <email>, folds keyed date', () => {
    const raw = [
      'Registered for         : Tavomi Rekasu',
      '                         48 Fiyaro Crescent',
      '                         Pinetown',
      '                         3610',
      '                         South Africa',
      '',
      'Administrative Contact : Jane Doe <jane@ex.net>',
      '                         DAC',
      '                         12 High Road',
      '                         Durban',
      '                         KZN',
      '                         4001',
      '                         South Africa',
      '                         031999',
      '',
      'Record Created         : Fri Mar 29 22:03:53 GMT 2002',
    ].join('\n');
    const format = deriveFormat({
      format: 'block-scoped',
      blankLinesInBlocks: true,
      sectionHeaders: ['Registered for', 'Administrative Contact'],
      positionalTemplates: {
        'registered for': {
          scope: 'registrant',
          headerField: 'name',
          lines: ['address', 'city', 'postalCode', 'country'],
        },
        'administrative contact': {
          scope: 'admin',
          headerField: 'name',
          headerEmail: 'email',
          lines: ['org', 'address', 'city', 'state', 'postalCode', 'country', 'phone'],
        },
      },
      aliases: { creationDate: ['Record Created'] },
    } as any);
    const { parsed } = mapEntries(tokenize(raw, format.tokenizer), format) as any;
    expect(parsed.registrantName).toBe('Tavomi Rekasu');
    expect(parsed.registrantCity).toBe('Pinetown');
    expect(parsed.registrantPostalCode).toBe('3610');
    expect(parsed.registrantCountry).toBe('South Africa');
    // header `Name <email>` splits into name + email; body maps by position
    expect(parsed.adminName).toBe('Jane Doe');
    expect(parsed.adminEmail).toBe('jane@ex.net');
    expect(parsed.adminOrg).toBe('DAC');
    expect(parsed.adminState).toBe('KZN');
    expect(parsed.adminPhone).toBe('031999');
    // a keyed domain-level line folded into the last positional block still maps globally
    expect(parsed.creationDate).toBe('Fri Mar 29 22:03:53 GMT 2002');
  });
});

describe('cocca is icann-shaped (flat key-prefix)', () => {
  it('parses standard RA-spec keys the same as icann', () => {
    const raw = [
      'Domain Name: example.tl',
      'Registry Domain ID: 123-CoCCA',
      'Creation Date: 2003-05-23T12:00:00Z',
      'Registrant Name: Domain Administrator',
      'Registrant Email: admin@example.tl',
      'Name Server: ns1.example.com',
    ].join('\n');
    const d = parse(raw, 'cocca');
    expect(d.domainName).toBe('example.tl');
    expect(d.domainId).toBe('123-CoCCA');
    expect(d.registrantName).toBe('Domain Administrator');
    expect(d.registrantEmail).toBe('admin@example.tl');
    expect(d.nameservers).toEqual(['ns1.example.com']);
  });
});

describe('per-server hooks: preprocess + regexFields bridge (§6u)', () => {
  it('regexFields overrides the block value on match and keeps it on miss (whois.monic.mo)', () => {
    const raw = [
      'Domain name: monic.mo',
      '',
      'Record created on 1993-01-01',
      'Record expires on 2027-12-31',
      '',
      'Domain name servers:',
      '  -------',
      'ns1.monic.mo',
      'ns2.monic.mo',
    ].join('\n');
    const d = parseBlocks(raw, 'whois.monic.mo', DOMAIN_QUERY_TYPE).data as any;
    // the colon-less date phrases have no key — only the regex rule can reach them
    expect(d.creationDate).toEqual(new Date('1993-01-01T00:00:00Z'));
    expect(d.expirationDate).toEqual(new Date('2027-12-31T00:00:00Z'));
    // fields WITHOUT a rule keep the block-mapped value
    expect(d.domainName).toBe('monic.mo');
    expect(d.nameservers).toEqual(['ns1.monic.mo', 'ns2.monic.mo']);
  });

  it('preprocess rewrites raw before tokenize; regexFields still sees the true raw', () => {
    const raw = ['%% Owner Section', 'Name: Jane Doe', 'created .... 2001-02-03'].join('\n');
    const format = deriveFormat({
      format: 'block-scoped',
      sectionHeaders: ['Owner Section'],
      blockScopes: { 'owner section': 'registrant' },
      // strip the `%% ` so the header is data rather than a notice
      preprocess: (text: string) => text.replace(/^%% /gm, ''),
      regexFields: { creationDate: 'created \\.+ (.+)' },
    } as any);
    const d = parseBlocks(raw, 'test.server', DOMAIN_QUERY_TYPE, format as any).data as any;
    expect(d.registrantName).toBe('Jane Doe');
    expect(d.creationDate).toEqual(new Date('2001-02-03T00:00:00Z'));
  });
});
