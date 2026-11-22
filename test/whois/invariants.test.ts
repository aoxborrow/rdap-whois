// What must hold for any WHOIS response the parser reads, whatever the response says.
//
// The golden test compares a response with the JSON written for it, so it only covers the
// responses that have one. These checks need no golden: they run over every recorded
// response, and a fixture someone contributes is useful the moment it is added.
//
// A rule's known exceptions are listed beside it with the reason. An exception that stops
// failing fails the test too, so the lists cannot go stale.
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMAIN_QUERY_TYPE } from '../../src/common/constants';
import { isValidHostname, toAscii } from '../../src/common/utils';
import { isEppStatus } from '../../src/record/epp';
import { isUsableRecord } from '../../src/record/record';
import { transformWhoisDomainData } from '../../src/record/transforms';
import type { DomainData } from '../../src/record/types';
import type { WhoisDataType } from '../../src/whois/data-types';
import { readFixture } from '../../scripts/whois/lib/raw';
import { parseBlocks, type MappedResult } from '../../src/whois/mapping';

const ROOT = fileURLToPath(new URL('../../fixtures/whois/', import.meta.url));

interface Fixture {
  // `<server>___<query>`
  base: string;
  server: string;
  query: string;
  parsed: MappedResult;
  data: Record<string, unknown>;
}

// every response in a lane, parsed. Fixtures are `<server>___<query>.txt`
function load(lane: string): Fixture[] {
  return readdirSync(`${ROOT}${lane}`)
    .filter(file => file.endsWith('.txt') && file.includes('___'))
    .sort()
    .map(file => {
      const base = file.slice(0, -'.txt'.length);
      const server = base.slice(0, base.indexOf('___'));
      const query = base.slice(base.indexOf('___') + '___'.length);
      const raw = readFixture(`${ROOT}${lane}/${file}`);
      const parsed = parseBlocks(raw, server, DOMAIN_QUERY_TYPE);
      return {
        base,
        server,
        query,
        parsed,
        data: parsed.data as unknown as Record<string, unknown>,
      };
    });
}

// run a rule over the fixtures. Returns what broke it outside the known exceptions, and
// the known exceptions that no longer break it
function check(
  fixtures: Fixture[],
  rule: (fixture: Fixture) => string[],
  known: Record<string, string> = {}
): { failures: string[]; stale: string[] } {
  const failures: string[] = [];
  const stale: string[] = [];
  for (const fixture of fixtures) {
    const problems = rule(fixture);
    if (problems.length && !(fixture.base in known)) {
      failures.push(...problems.map(problem => `${fixture.base}: ${problem}`));
    }
    if (!problems.length && fixture.base in known) stale.push(fixture.base);
  }
  // the first few are more useful than a count when this fails
  return { failures: failures.slice(0, 20), stale };
}

const DATE_FIELDS = ['creationDate', 'expirationDate', 'updatedDate'] as const;
// the first .com was registered in 1985. Registries write 2998 to 3000 for a name that
// never expires, which is their answer and is kept
const EARLIEST_YEAR = 1985;
const LATEST_YEAR = 3000;

describe('whois invariants: responses for registered names', () => {
  let found: Fixture[] = [];
  beforeAll(() => {
    found = load('found');
  });

  it('has a corpus to check', () => {
    expect(found.length).toBeGreaterThan(2500);
  });

  it('reads none of them as not-found, reserved, throttled or a server failure', () => {
    const { failures } = check(found, ({ parsed }) =>
      parsed.status === 'found' ? [] : [`read as ${parsed.status}`]
    );
    expect(failures).toEqual([]);
  });

  it('parses every date to a real date in a believable year', () => {
    const { failures, stale } = check(found, ({ data }) =>
      DATE_FIELDS.flatMap(field => {
        const value = data[field];
        if (value === null || value === undefined) return [];
        if (!(value instanceof Date)) return [`${field} is not a Date`];
        if (Number.isNaN(value.getTime())) return [`${field} is an invalid Date`];
        const year = value.getUTCFullYear();
        return year < EARLIEST_YEAR || year > LATEST_YEAR
          ? [`${field} is ${value.toISOString()}`]
          : [];
      })
    );
    expect(failures).toEqual([]);
    expect(stale).toEqual([]);
  });

  it('parses every nameserver to a lower-case hostname', () => {
    const { failures, stale } = check(
      found,
      ({ data }) =>
        ((data.nameservers as unknown[] | null) ?? [])
          .filter(
            ns =>
              typeof ns !== 'string' ||
              ns !== ns.toLowerCase() ||
              !ns.includes('.') ||
              !isValidHostname(ns)
          )
          .map(ns => `nameserver ${JSON.stringify(ns)}`),
      {}
    );
    expect(failures).toEqual([]);
    expect(stale).toEqual([]);
  });

  it('keeps only EPP status codes in eppStatus', () => {
    const { failures } = check(found, ({ data }) =>
      ((data.eppStatus as string[] | null) ?? [])
        .filter(status => !isEppStatus(status))
        .map(status => `status ${JSON.stringify(status)}`)
    );
    expect(failures).toEqual([]);
  });

  it('parses the name that was asked for', () => {
    const { failures, stale } = check(
      found,
      ({ data, query, server }) => {
        // IANA answers about the TLD, not the name
        if (server === 'whois.iana.org') return [];
        if (typeof data.domainName !== 'string') return ['no domain name'];
        // a registry may answer an internationalised name in its own script
        const name = toAscii(data.domainName.toLowerCase());
        const asked = toAscii(query.toLowerCase());
        // some registries answer for the registrable name above the one asked for
        return name === asked || asked.endsWith(`.${name}`)
          ? []
          : [`domain name is ${JSON.stringify(data.domainName)}`];
      },
      {
        // the registry answers in its other script
        'whois.twnic.net.tw___nic.xn--kprw13d': 'the name in the traditional-script TLD',
        // since 2025 the server's answer has no "Domain name:" line
        'whois.nic.cl___mercadolibre.cl': 'no domain name',
      }
    );
    expect(failures).toEqual([]);
    expect(stale).toEqual([]);
  });

  it('builds a record from every one of them', () => {
    const { failures, stale } = check(
      found,
      ({ data, query, parsed }) => {
        let record: DomainData;
        try {
          record = transformWhoisDomainData({
            query,
            queryType: DOMAIN_QUERY_TYPE,
            data: data as unknown as WhoisDataType,
            reserved: parsed.status === 'reserved',
          });
        } catch (error) {
          return [`the record throws: ${error instanceof Error ? error.message : String(error)}`];
        }
        const problems: string[] = [];
        if (record.available || record.reserved) {
          problems.push(`available is ${record.available}, reserved is ${record.reserved}`);
        }
        if (record.domainName !== record.domainName.toLowerCase()) {
          problems.push(`domainName is ${JSON.stringify(record.domainName)}`);
        }
        // a registration a lookup can use: the sparsest registries included
        if (!isUsableRecord(record)) {
          problems.push('the record is not a usable answer');
        }
        return problems;
      },
      {}
    );
    expect(failures).toEqual([]);
    expect(stale).toEqual([]);
  });

  // Not a rule, by decision: the record keeps a registry's privacy notice ("REDACTED FOR
  // PRIVACY", "Not Disclosed") as the value of the field it stands in for, as the server
  // wrote it. A caller that wants nulls there replaces them
});

describe('whois invariants: responses that are not a registration', () => {
  it.each([
    ['notfound', {}],
    ['reserved', {}],
    ['throttled', {}],
    ['servfail', {}],
  ] as const)('reads every %s response as %s', (lane, known) => {
    const status = lane === 'servfail' ? 'error' : lane;
    const fixtures = load(lane);
    expect(fixtures.length).toBeGreaterThan(10);
    const { failures, stale } = check(
      fixtures,
      ({ parsed }) => (parsed.status === status ? [] : [`read as ${parsed.status}`]),
      known
    );
    expect(failures).toEqual([]);
    expect(stale).toEqual([]);
  });
});
