// The servers/ registry convention (docs/archive/whois-parser-refactor.md §6u): the FILENAME is
// the server map — every whois.<host>.ts defines that host's config, and generated/whois/servers.ts
// AUTO-GENERATED from the directory listing. This test fails when the registry is stale
// (a host file was added/renamed/removed without re-running the generator).
import { readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import { FORMAT_CONFIGS } from '../../src/whois/formats';

describe('servers registry', () => {
  it('generated map matches the host-file listing (regen: npm run whois:generate:servers)', () => {
    // resolved from this file, not process.cwd(), so a repo-root vitest run passes too
    const dir = fileURLToPath(new URL('../../src/whois/servers', import.meta.url));
    const files = readdirSync(dir)
      .filter(f => /^(whois|www)\./.test(f) && f.endsWith('.ts'))
      .map(f => f.slice(0, -3))
      .sort();
    const keys = Object.keys(FORMAT_CONFIGS).sort();
    expect(keys, 'stale generated/whois/servers.ts — run `npm run whois:generate:servers`').toEqual(
      files
    );
  });
});
