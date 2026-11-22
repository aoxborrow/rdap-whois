import { describe, expect, it, vi } from 'vitest';
import { RateLimitError, TimeoutError, type RdapWhois, type WhoisHop } from '../../../src/index';
import { DOMAIN_REQUIRED_FIELDS } from '../../../src/whois/base';
import { probeWhoisServer } from '../../../scripts/whois/probe/whois-probe';

// a client whose whois() answers with the given hop, or throws the given error
function clientWith(answer: Partial<WhoisHop> | Error): RdapWhois {
  const whois = vi.fn(async () => {
    if (answer instanceof Error) throw answer;
    return [
      { server: 'whois.example', status: 'found', raw: 'Domain Name: EXAMPLE.COM', ...answer },
    ];
  });
  return { whois } as unknown as RdapWhois;
}

const probe = (answer: Partial<WhoisHop> | Error) =>
  probeWhoisServer('whois.example', 'example.com', 1000, clientWith(answer));

describe('probeWhoisServer', () => {
  it('scores a parsed record against every required field', async () => {
    const data = Object.fromEntries(DOMAIN_REQUIRED_FIELDS.map(field => [field, 'x']));
    expect(await probe({ data: data as never })).toEqual({
      classification: 'healthy',
      score: DOMAIN_REQUIRED_FIELDS.length,
    });
  });

  it('does not count fields that came out null', async () => {
    const data = { domainName: 'example.com', creationDate: null, nameservers: ['ns1.example'] };
    expect(await probe({ data: data as never })).toEqual({ classification: 'healthy', score: 2 });
  });

  it('calls a server that answers with an error page refused, not healthy', async () => {
    const outcome = await probe({ status: 'error', raw: 'TLD is not supported.\n', data: null });
    expect(outcome).toEqual({
      classification: 'refused',
      detail: 'error page: TLD is not supported.',
    });
  });

  it('calls a notfound for a registered probe name a notfound false positive', async () => {
    expect((await probe({ status: 'notfound', data: null })).classification).toBe('notfound-fp');
  });

  it('keeps a throttled server alive and a timed-out one a dead candidate', async () => {
    expect((await probe(new RateLimitError('slow down'))).classification).toBe('throttled');
    expect((await probe(new TimeoutError('timed out'))).classification).toBe('dead-candidate');
  });

  it('calls a response with no text suspect', async () => {
    expect((await probe({ raw: null, data: null })).classification).toBe('suspect');
  });
});
