import { describe, expect, it } from 'vitest';
import { BaseServerCache } from '../../src/rdap/cache/base';
import { normalizeRdapServer } from '../../src/rdap/utils';

class TestServerCache extends BaseServerCache {
  constructor(server: string) {
    super({ description: '', publication: '', version: '1.0', services: [[['test'], [server]]] });
  }
}

const CASES = [
  ['http://rdap.example:80/', 'https://rdap.example/'],
  ['http://rdap.example:80', 'https://rdap.example/'],
  ['http://rdap.example:80/rdap/domain/one.test', 'https://rdap.example/rdap/'],
  ['http://rdap.example/rdap/', 'https://rdap.example/rdap/'],
  ['http://rdap.example:8080/rdap/', 'https://rdap.example:8080/rdap/'],
  ['http://rdap.example:8000/', 'https://rdap.example:8000/'],
  ['http://[2001:db8::80]/', 'https://[2001:db8::80]/'],
  ['http://[2001:db8::1]:80/', 'https://[2001:db8::1]/'],
  ['https://rdap.example:8443/rdap/', 'https://rdap.example:8443/rdap/'],
  ['https://rdap.example:80/', 'https://rdap.example:80/'],
] as const;

describe('normalizeRdapServer', () => {
  it.each(CASES)('normalizes %s to %s', (server, expected) => {
    expect(normalizeRdapServer(server)).toBe(expected);
  });
});

describe('a bootstrap server', () => {
  it.each(CASES)('is stored for %s as %s', (server, expected) => {
    expect(new TestServerCache(server).getServer('test')).toBe(expected);
  });
});
