import { describe, expect, it } from 'vitest';
import { parseProxy, redactProxy, resolveProxy } from '../../src/net/proxy';
import { checkRdapTarget, checkWhoisTarget } from '../../src/net/targets';

const blocked = (check: { ok: boolean; reason?: string }): string =>
  check.ok ? 'allowed' : (check.reason ?? '');

describe('checkRdapTarget', () => {
  it('allows an https URL on a public hostname', () => {
    expect(checkRdapTarget('https://rdap.verisign.com/com/v1/domain/example.com')).toEqual({
      ok: true,
      target: {
        url: 'https://rdap.verisign.com/com/v1/domain/example.com',
        host: 'rdap.verisign.com',
        port: 443,
      },
    });
  });

  it('upgrades http to https, dropping the plain-HTTP port', () => {
    const check = checkRdapTarget('http://rdap.example.org:8080/domain/example.org');
    expect(check).toEqual({
      ok: true,
      target: {
        url: 'https://rdap.example.org/domain/example.org',
        host: 'rdap.example.org',
        port: 443,
      },
    });
  });

  it('keeps http when the policy allows it', () => {
    const check = checkRdapTarget('http://rdap.example.org:8080/domain/example.org', {
      allowInsecure: true,
    });
    expect(check.ok && check.target).toEqual({
      url: 'http://rdap.example.org:8080/domain/example.org',
      host: 'rdap.example.org',
      port: 8080,
    });
  });

  it('blocks a URL carrying credentials', () => {
    expect(blocked(checkRdapTarget('https://user:pass@rdap.example.org/domain/x'))).toMatch(
      /credentials/
    );
  });

  it('does not repeat the credentials in the reason', () => {
    expect(blocked(checkRdapTarget('https://user:hunter2@rdap.example.org/'))).not.toContain(
      'hunter2'
    );
  });

  it.each([
    ['an IPv4 literal', 'https://127.0.0.1/domain/x'],
    ['a public IPv4 literal', 'https://8.8.8.8/domain/x'],
    ['an IPv6 literal', 'https://[::1]/domain/x'],
    ['localhost', 'https://localhost/domain/x'],
    ['a .localhost name', 'https://rdap.localhost/domain/x'],
    ['a .local name', 'https://printer.local/domain/x'],
    ['a .internal name', 'https://rdap.corp.internal/domain/x'],
    ['a single-label name', 'https://intranet/domain/x'],
  ])('blocks %s', (_, url) => {
    expect(checkRdapTarget(url).ok).toBe(false);
  });

  it.each([
    ['an IP literal', 'https://127.0.0.1:8443/domain/x'],
    ['localhost', 'https://localhost:8443/domain/x'],
    ['a single-label name', 'https://intranet/domain/x'],
  ])('allows %s when the policy allows private targets', (_, url) => {
    expect(checkRdapTarget(url, { allowPrivate: true }).ok).toBe(true);
  });

  it.each([
    ['a non-HTTP scheme', 'ftp://rdap.example.org/domain/x'],
    ['a file URL', 'file:///etc/passwd'],
    ['something that is not a URL', 'not a url'],
  ])('blocks %s', (_, url) => {
    expect(checkRdapTarget(url).ok).toBe(false);
  });

  it('applies the caller’s own check last, to the URL that would be requested', () => {
    const seen: string[] = [];
    const check = checkRdapTarget('http://rdap.example.org/domain/x', {
      allow: target => {
        seen.push(target.url ?? '');
        return false;
      },
    });
    expect(check.ok).toBe(false);
    expect(seen).toEqual(['https://rdap.example.org/domain/x']);
  });
});

describe('checkWhoisTarget', () => {
  it('allows a public hostname', () => {
    expect(checkWhoisTarget('whois.Verisign-GRS.com', 43)).toEqual({
      ok: true,
      target: { host: 'whois.verisign-grs.com', port: 43 },
    });
  });

  it.each([
    ['an IP address', '192.0.2.1'],
    ['localhost', 'localhost'],
    ['a local name', 'whois.local'],
    ['a name with a path', 'whois.example.com/x'],
    ['a name with a space', 'whois example.com'],
    ['an empty name', ''],
  ])('blocks %s', (_, host) => {
    expect(checkWhoisTarget(host, 43).ok).toBe(false);
  });

  it('blocks a port that is not a port', () => {
    expect(checkWhoisTarget('whois.example.com', 0).ok).toBe(false);
    expect(checkWhoisTarget('whois.example.com', 70000).ok).toBe(false);
  });

  it('allows a local server when the policy allows private targets', () => {
    expect(checkWhoisTarget('127.0.0.1', 4343, { allowPrivate: true }).ok).toBe(true);
  });

  it('applies the caller’s own check', () => {
    const allow = (target: { host: string }) => target.host.endsWith('.example.com');
    expect(checkWhoisTarget('whois.example.com', 43, { allow }).ok).toBe(true);
    expect(checkWhoisTarget('whois.example.net', 43, { allow }).ok).toBe(false);
  });
});

describe('parseProxy', () => {
  it('reads a SOCKS5 URL with credentials', () => {
    expect(parseProxy('socks5://user:p%40ss@proxy.example.com:1080')).toEqual({
      protocol: 'socks5',
      host: 'proxy.example.com',
      port: 1080,
      username: 'user',
      password: 'p@ss',
    });
  });

  it('treats socks5h and socks as SOCKS5, with the default port', () => {
    expect(parseProxy('socks5h://proxy.example.com')).toEqual({
      protocol: 'socks5',
      host: 'proxy.example.com',
      port: 1080,
    });
    expect(parseProxy('socks://proxy.example.com').protocol).toBe('socks5');
  });

  it('reads HTTP and HTTPS proxies, with their default ports', () => {
    expect(parseProxy('http://proxy.example.com')).toMatchObject({ protocol: 'http', port: 80 });
    expect(parseProxy('https://proxy.example.com')).toMatchObject({
      protocol: 'https',
      port: 443,
    });
    expect(parseProxy('http://proxy.example.com:3128').port).toBe(3128);
  });

  it('carries the connect timeout from the object form', () => {
    expect(
      parseProxy({ url: 'socks5://proxy.example.com', connectTimeout: 8000 }).connectTimeout
    ).toBe(8000);
  });

  it('rejects a scheme it cannot use, and something that is not a URL', () => {
    expect(() => parseProxy('socks4://proxy.example.com')).toThrow(TypeError);
    expect(() => parseProxy('proxy.example.com:1080')).toThrow(TypeError);
    expect(() => parseProxy('')).toThrow(TypeError);
  });

  it('does not repeat the credentials when it rejects a URL', () => {
    try {
      parseProxy('socks4://user:hunter2@proxy.example.com');
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain('hunter2');
    }
  });
});

describe('redactProxy', () => {
  it('removes the credentials and keeps the rest', () => {
    expect(redactProxy('socks5://user:hunter2@proxy.example.com:1080')).toBe(
      'socks5://***@proxy.example.com:1080'
    );
    expect(redactProxy({ url: 'http://proxy.example.com:3128' })).toBe(
      'http://proxy.example.com:3128'
    );
  });

  it('gives nothing away for a URL it cannot read', () => {
    expect(redactProxy('user:hunter2@')).toBe('<invalid proxy url>');
  });
});

describe('resolveProxy', () => {
  it('uses one proxy for both protocols, or none', () => {
    for (const protocol of ['whois', 'rdap'] as const) {
      expect(resolveProxy('socks5://proxy.example.com', protocol)?.host).toBe('proxy.example.com');
      expect(
        resolveProxy({ url: 'http://proxy.example.com:3128', connectTimeout: 500 }, protocol)
      ).toMatchObject({ protocol: 'http', port: 3128, connectTimeout: 500 });
      expect(resolveProxy(undefined, protocol)).toBeUndefined();
    }
  });

  it('uses each protocol’s own proxy, and goes direct for one with none', () => {
    const option = {
      whois: 'socks5://proxy.example.com',
      rdap: { url: 'https://proxy.example.com', connectTimeout: 1000 },
    };
    expect(resolveProxy(option, 'whois')).toMatchObject({ protocol: 'socks5', port: 1080 });
    expect(resolveProxy(option, 'rdap')).toMatchObject({
      protocol: 'https',
      port: 443,
      connectTimeout: 1000,
    });
    expect(resolveProxy({ whois: 'socks5://proxy.example.com' }, 'rdap')).toBeUndefined();
  });

  it('refuses an option of neither shape', () => {
    const route = () => 'socks5://proxy.example.com';
    expect(() => resolveProxy(route as never, 'whois')).toThrow(TypeError);
  });
});
