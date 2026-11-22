// the rdap-whois command's own arguments: help, version, and the proxy from the environment.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { VERSION } from '../src/version';

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

function run(args: string[], env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', cli, ...args], {
    encoding: 'utf8',
    env: { ...process.env, RDAP_WHOIS_PROXY: '', ...env },
    timeout: 30_000,
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('the rdap-whois command', () => {
  it('prints its usage for -h and --help, without looking anything up', () => {
    for (const flag of ['-h', '--help']) {
      const { code, stdout } = run([flag]);
      expect(code, flag).toBe(0);
      expect(stdout, flag).toMatch(/^usage: rdap-whois/);
    }
  });

  it('prints its version for --version', () => {
    expect(run(['--version'])).toMatchObject({ code: 0, stdout: `${VERSION}\n` });
  });

  it('takes the proxy from RDAP_WHOIS_PROXY when --proxy is not given', () => {
    // a proxy URL that cannot be read fails before anything connects, and says why
    const { code, stderr } = run(['example.com', '--whois'], { RDAP_WHOIS_PROXY: 'nonsense' });
    expect(code).toBe(1);
    expect(stderr).toMatch(/proxy/i);
  });

  it('takes --verbose for a domain lookup only', () => {
    const { code, stderr } = run(['example.com', '--whois', '--verbose']);
    expect(code).toBe(2);
    expect(stderr).toMatch(/--verbose is for a domain lookup/);
  });
});
