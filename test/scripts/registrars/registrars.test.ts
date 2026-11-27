import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildRegistrars,
  coverage,
  evidenceFrom,
  normalizeHost,
  parseIanaRegistrars,
  type Evidence,
  type IanaRegistrar,
} from '../../../scripts/registrars/registrars';

const XML = `<registry id="registrar-ids">
  <updated>2026-11-25</updated>
  <registry id="registrar-ids-1">
    <record><value>1</value><name>Reserved</name><status>Reserved</status></record>
    <record updated="2019-08-08">
      <value>2</value>
      <name>Network Solutions, LLC</name>
      <status>Accredited</status>
      <rdapurl><server>https://RDAP.networksolutions.com/rdap</server></rdapurl>
    </record>
    <record><value>9</value><name>A &amp; B Domains</name><status>Terminated</status></record>
  </registry>
</registry>`;

describe('parseIanaRegistrars', () => {
  it('reads every record with its status and normalized RDAP base', () => {
    const { updated, registrars } = parseIanaRegistrars(XML);
    expect(updated).toBe('2026-11-25');
    expect(registrars).toEqual([
      { id: '1', name: 'Reserved', status: 'Reserved', rdap: null },
      {
        id: '2',
        name: 'Network Solutions, LLC',
        status: 'Accredited',
        rdap: 'https://rdap.networksolutions.com/rdap/',
      },
      { id: '9', name: 'A & B Domains', status: 'Terminated', rdap: null },
    ]);
  });
});

describe('normalizeHost', () => {
  it('reduces the forms answers write to a hostname', () => {
    expect(normalizeHost('whois://Whois.Example.com/')).toBe('whois.example.com');
    expect(normalizeHost('whois.example.com:43')).toBe('whois.example.com');
    expect(normalizeHost('registrar')).toBeNull();
    expect(normalizeHost('192.0.2.1')).toBeNull();
    expect(normalizeHost('')).toBeNull();
  });
});

describe('evidenceFrom', () => {
  const registries = new Set(['whois.verisign-grs.com', 'whois.nic.example']);
  const registrars = new Set(['whois.known-registrar.com']);
  const answer = (host: string): string =>
    `Domain Name: EXAMPLE.COM\nRegistrar WHOIS Server: ${host}\nRegistrar IANA ID: 1068\n`;
  const from = (server: string, raw: string, domain = 'example.com') =>
    evidenceFrom(server, domain, raw, registries, registrars, true);

  it("takes a registry's answer as a referral naming the sponsor's server", () => {
    expect(from('whois.verisign-grs.com', answer('whois.namecheap.com'))).toEqual({
      id: '1068',
      host: 'whois.namecheap.com',
      kind: 'referral',
      domain: 'example.com',
      live: true,
    });
  });

  it("drops a registry's own server named as the registrar's", () => {
    expect(
      from('whois.verisign-grs.com', answer('whois.nic.example'), 'x.example')?.host
    ).toBeNull();
  });

  it("takes a registrar server's own answer as evidence for itself", () => {
    expect(from('whois.namecheap.com', answer('whois.namecheap.com'))).toMatchObject({
      id: '1068',
      host: 'whois.namecheap.com',
      kind: 'self',
    });
    expect(from('whois.known-registrar.com', 'Registrar IANA ID: 1068\n')).toMatchObject({
      host: 'whois.known-registrar.com',
      kind: 'self',
    });
  });

  it('takes an unrouted server naming another server as a referral, not as itself', () => {
    // a retired ZACR host: routing now sends .capetown to whois.nic.capetown
    const raw = readFileSync(
      fileURLToPath(
        new URL(
          '../../../fixtures/whois/found/capetown-whois.registry.net.za___registry.capetown.txt',
          import.meta.url
        )
      ),
      'utf8'
    );
    expect(from('capetown-whois.registry.net.za', raw, 'registry.capetown')).toMatchObject({
      id: '2287',
      host: 'whois.gateway.africa',
      kind: 'referral',
    });
    expect(from('whois.unknown.example', 'Registrar IANA ID: 1068\n')).toMatchObject({
      host: null,
      kind: 'referral',
    });
  });

  it('finds nothing in an answer that names no IANA ID', () => {
    expect(from('whois.verisign-grs.com', 'No match')).toBeNull();
  });
});

describe('buildRegistrars', () => {
  const iana = (id: string, rdap: string | null, status = 'Accredited'): IanaRegistrar => ({
    id,
    name: `Registrar ${id}`,
    status,
    rdap,
  });
  const vote = (id: string, host: string, live: boolean, domain = 'x.com'): Evidence => ({
    id,
    host,
    kind: 'referral',
    domain,
    live,
  });

  it('keeps only accredited registrars', () => {
    expect(
      Object.keys(buildRegistrars([iana('1', null), iana('2', null, 'Terminated')], [], {}))
    ).toEqual(['1']);
  });

  it('prefers live evidence, then a server on its RDAP base domain, then the most evidence', () => {
    const rdap = 'https://rdap.porkbun.com/';
    const built = buildRegistrars(
      [iana('1861', rdap), iana('895', 'https://rdap.squarespace.domains/')],
      [
        vote('1861', 'porkbun.com', false),
        vote('1861', 'porkbun.com', false),
        vote('1861', 'whois.porkbun.com', true),
        vote('895', 'whois.donuts.co', false),
        vote('895', 'whois.donuts.co', false),
        vote('895', 'whois.squarespace.domains', false),
      ],
      {}
    );
    expect(built['1861'].whois).toBe('whois.porkbun.com');
    expect(built['895'].whois).toBe('whois.squarespace.domains');
  });

  it("picks the registrar's own domain, then a gTLD one, as its confirmed domain", () => {
    const built = buildRegistrars(
      [iana('1', 'https://rdap.example.com/'), iana('2', null)],
      [
        vote('1', 'whois.example.com', true, 'a.io'),
        vote('1', 'whois.example.com', true, 'example.com'),
        vote('2', 'whois.two.net', true, 'b.io'),
        vote('2', 'whois.two.net', true, 'longer.shop'),
      ],
      {}
    );
    expect(built['1'].domain).toBe('example.com');
    expect(built['2'].domain).toBe('longer.shop');
  });

  it('gives a registrar with no evidence the one server of the others on its RDAP base', () => {
    const shared = 'https://rdap.namebright.com/rdap/';
    const mixed = 'https://rdapserver.net/';
    const built = buildRegistrars(
      [iana('1', shared), iana('2', shared), iana('3', mixed), iana('4', mixed), iana('5', mixed)],
      [
        vote('1', 'whois.namebright.com', true),
        vote('3', 'whois.a.com', true),
        vote('4', 'whois.b.com', true),
      ],
      {}
    );
    expect(built['2'].whois).toBe('whois.namebright.com');
    // two different servers on one base, neither on its domain: no guess
    expect(built['5'].whois).toBeNull();
  });

  it('chooses a retired server again only on live evidence', () => {
    const before = { name: 'Old', rdap: null, whois: 'whois.gone.com', domain: null };
    const retired = new Set(['whois.gone.com']);
    const built = buildRegistrars(
      [iana('1', null), iana('2', null), iana('3', null)],
      [vote('2', 'whois.gone.com', false), vote('3', 'whois.gone.com', true)],
      { '1': before, '2': before, '3': before },
      retired
    );
    expect(built['1'].whois).toBeNull();
    expect(built['2'].whois).toBeNull();
    expect(built['3'].whois).toBe('whois.gone.com');
  });

  it("keeps the earlier list's server and domain when there is no evidence", () => {
    const built = buildRegistrars([iana('7', null)], [], {
      '7': { name: 'Old', rdap: null, whois: 'whois.seven.com', domain: 'seven.com' },
    });
    expect(built['7']).toMatchObject({
      name: 'Registrar 7',
      whois: 'whois.seven.com',
      domain: 'seven.com',
    });
    expect(coverage(built)).toMatchObject({
      accredited: 1,
      whois: 1,
      rdap: 0,
      both: 0,
      neither: 0,
    });
  });
});
