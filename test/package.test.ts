import { build } from 'esbuild';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { binEntries, entries } from '../tsup.config';

// The package's shape is declared in three places that have to agree: the `exports` map
// the monorepo resolves (source), `publishConfig.exports` that npm consumers resolve
// (dist), and the build entries. A new entry point added to only one of them would work
// here and break on publish, or the reverse. Below that, what each entry point loads.
//
// Extracted to its own repository (scripts/extract.sh), the package has one map, `exports`,
// pointing at dist, and no `publishConfig.exports`. The checks read either shape.

interface ConditionalTarget {
  types: string;
  default: string;
}

type PublishedExports = Record<string, ConditionalTarget | string>;

interface Manifest {
  version: string;
  engines: { node: string };
  sideEffects: boolean;
  files: string[];
  exports: Record<string, string> | PublishedExports;
  bin?: Record<string, string>;
  publishConfig: {
    bin?: Record<string, string>;
    exports?: PublishedExports;
  };
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as Manifest;

// in the monorepo `exports` names the source files; standalone it is the published map
const inMonorepo = Object.values(manifest.exports).every(target => typeof target === 'string');
const published = (
  inMonorepo ? manifest.publishConfig.exports : manifest.exports
) as PublishedExports;
const publishedBin = inMonorepo ? manifest.publishConfig.bin : manifest.bin;

// the source file of each entry point: './src/whois/index.ts'. Standalone it is read back
// from the build output the entry maps to, which keeps the source layout
const sources: Record<string, string> = inMonorepo
  ? (manifest.exports as Record<string, string>)
  : Object.fromEntries(
      Object.entries(published).map(([subpath, target]) => [
        subpath,
        typeof target === 'string'
          ? target
          : target.default.replace(/^\.\/dist\//, './src/').replace(/\.js$/, '.ts'),
      ])
    );

// the build keeps the source layout: './src/whois/index.ts' -> 'whois/index'
const distBase = (subpath: string) =>
  sources[subpath].replace(/^\.\/src\//, '').replace(/\.ts$/, '');

describe('package manifest', () => {
  it('has no wildcard export', () => {
    expect(Object.keys(published).filter(key => key.includes('*'))).toEqual([]);
  });

  it('points every source export at a file that exists', () => {
    for (const target of Object.values(sources)) {
      expect(existsSync(path.join(root, target)), target).toBe(true);
    }
  });

  it('publishes the same entry points it exposes in the monorepo', () => {
    expect(Object.keys(published).sort()).toEqual(Object.keys(manifest.exports).sort());
  });

  it('builds exactly the exported entry points', () => {
    const exported = Object.values(sources)
      .filter(target => target !== './package.json')
      .map(target => target.replace(/^\.\//, ''));
    expect([...entries].sort()).toEqual(exported.sort());
  });

  it('declares no side effects, so a bundler may drop what is not used', () => {
    expect(manifest.sideEffects).toBe(false);
  });

  it('publishes the build and the documents only: the data is built into dist', () => {
    expect(manifest.files).toEqual(['dist', '/README.md', '/LICENSE', '/CHANGELOG.md']);
  });

  it('is ES modules only, for a Node that can require() them', () => {
    expect(manifest.engines.node).toBe('>=22.12');
    for (const [subpath, target] of Object.entries(published)) {
      if (typeof target === 'string') continue;
      expect(Object.keys(target), subpath).toEqual(['types', 'default']);
    }
  });

  it('exports its package.json, for tools that read the version', () => {
    expect(published['./package.json']).toBe('./package.json');
    expect(manifest.exports['./package.json']).toBe('./package.json');
  });

  it('publishes the command from its build, and only in the published manifest', () => {
    // a bin in the monorepo manifest would point at a dist/ that is not built there
    if (inMonorepo) expect(manifest.bin).toBeUndefined();
    const built = binEntries.map(entry =>
      entry.replace(/^src\//, './dist/').replace(/\.ts$/, '.js')
    );
    expect(Object.values(publishedBin ?? {})).toEqual(built);
    for (const entry of binEntries) {
      expect(readFileSync(path.join(root, entry), 'utf8').startsWith('#!/usr/bin/env node\n')).toBe(
        true
      );
    }
  });

  it('ships no tooling: scripts, registry health and fixtures stay out of `files`', () => {
    for (const entry of manifest.files) {
      expect(entry).not.toMatch(/^(scripts|registry-health|fixtures|test)\b/);
    }
  });

  it('maps each published entry to the build output for that entry', () => {
    for (const [subpath, target] of Object.entries(published)) {
      if (subpath === './package.json') continue;
      const base = `./dist/${distBase(subpath)}`;
      expect(target).toEqual({ types: `${base}.d.ts`, default: `${base}.js` });
    }
  });
});

// every source module an entry point loads as soon as it is imported, following static
// imports only (a dynamic import() is loaded when a call needs it, not before)
async function staticModules(entry: string): Promise<string[]> {
  const result = await build({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    write: false,
    metafile: true,
    format: 'esm',
    platform: 'neutral',
    outdir: 'out',
    splitting: true,
    logLevel: 'silent',
    packages: 'external',
    external: ['node:*', 'cloudflare:sockets'],
  });
  const inputs = result.metafile.inputs;
  const start = path.relative(process.cwd(), path.join(root, entry));
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file) || !inputs[file]) return;
    seen.add(file);
    for (const imported of inputs[file].imports) {
      if (imported.kind !== 'dynamic-import' && !imported.external) visit(imported.path);
    }
  };
  visit(start);
  return [...seen].map(file => path.relative(root, path.resolve(process.cwd(), file)));
}

// the source modules left in a bundle of `code` once the bundler has dropped what the code
// does not use, as it does for a consumer's build
async function bundledModules(code: string): Promise<string[]> {
  const result = await build({
    stdin: { contents: code, resolveDir: root, loader: 'ts' },
    bundle: true,
    write: false,
    metafile: true,
    format: 'esm',
    platform: 'neutral',
    logLevel: 'silent',
    packages: 'external',
    external: ['node:*', 'cloudflare:sockets'],
  });
  return Object.values(result.metafile.outputs).flatMap(output =>
    Object.entries(output.inputs)
      .filter(([, input]) => input.bytesInOutput > 0)
      .map(([file]) => path.relative(root, path.resolve(process.cwd(), file)))
  );
}

// the WHOIS parser and its per-server formats
const WHOIS_PARSER = [
  'src/whois/mapping.ts',
  'src/whois/formats.ts',
  'src/whois/servers.ts',
  'src/whois/client.ts',
];
// the parser's formatters and its date reading, which loads date-fns: slow to import on Node
const WHOIS_DATES = ['src/whois/base.ts', 'src/whois/dates.ts'];
const NETWORK = ['src/core.ts', 'src/net/tunnel.ts', 'src/rdap/client.ts'];

describe('what each entry point loads', () => {
  it('the root loads no WHOIS parser until a call needs it', async () => {
    const loaded = await staticModules('src/index.ts');
    expect(loaded).toContain('src/client.ts');
    expect(loaded.filter(file => WHOIS_PARSER.includes(file))).toEqual([]);
  });

  it('the root and /utils load no date parsing', async () => {
    for (const entry of ['src/index.ts', 'src/utils.ts']) {
      const loaded = await staticModules(entry);
      expect(
        loaded.filter(file => WHOIS_DATES.includes(file)),
        entry
      ).toEqual([]);
    }
  });

  it('the root has one client, RdapWhois, and lookup(), whois() and rdap() on a shared one', async () => {
    const root = await import('../src/index');
    const whois = await import('../src/whois/index');
    expect('Rdap' in root).toBe(false);
    expect('Whois' in whois).toBe(false);
    for (const call of ['lookup', 'whois', 'rdap'] as const)
      expect(typeof root[call]).toBe('function');
  });

  it("/whois exports the WHOIS side only: the errors and the cache are the root's", async () => {
    const whois = await import('../src/whois/index');
    expect(Object.keys(whois).filter(name => /Error$|Cache$|^reviveDates$/.test(name))).toEqual([]);
  });

  it('/utils loads no network code', async () => {
    const loaded = await staticModules('src/utils.ts');
    expect(
      loaded.filter(file => NETWORK.includes(file) || file.startsWith('src/transports/'))
    ).toEqual([]);
    expect(loaded.filter(file => WHOIS_PARSER.includes(file))).toEqual([]);
  });
});
