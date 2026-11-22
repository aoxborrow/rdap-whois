// Runtime-neutrality check for the library.
//
// Everything except the Node transport must bundle for a browser target: no Node core
// modules, and no dependency that drags one in. The boundary lint guards the library's own
// imports; this catches what a dependency pulls in, by bundling every source module with
// esbuild's browser platform, where a `node:*` specifier fails to resolve.
//
// Run: `npm run check:browser` (wired into CI).
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { glob } from 'node:fs/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = resolve(root, 'src');

// the only files allowed to use Node built-ins (mirrors eslint.config.boundaries.mjs)
const NODE_ONLY = new Set(['transports/node.ts']);

const entryPoints = [];
for await (const entry of glob('**/*.ts', { cwd: srcRoot })) {
  if (/\.(test|spec)\.ts$/.test(entry) || NODE_ONLY.has(entry)) continue;
  entryPoints.push(resolve(srcRoot, entry));
}

try {
  await build({
    entryPoints,
    bundle: true,
    write: false,
    outdir: 'browser-check-out',
    platform: 'browser',
    format: 'esm',
    logLevel: 'warning',
    // the Node transport is reached only through a dynamic import(); leave it out. The
    // Workers transport imports a module that only exists on Workers
    external: [...[...NODE_ONLY].map(file => resolve(srcRoot, file)), 'cloudflare:sockets'],
  });
  console.log(`✓ rdap-whois is runtime-neutral — ${entryPoints.length} modules bundled clean.`);
} catch {
  console.error('✗ rdap-whois pulls in a Node built-in outside the Node transport.');
  process.exit(1);
}
