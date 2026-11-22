import { defineConfig, type Options } from 'tsup';

// one build entry per public entry point; test/package.test.ts keeps this list, the
// `exports` map and `publishConfig.exports` in step
export const entries = [
  'src/index.ts',
  'src/whois/index.ts',
  'src/utils.ts',
  'src/transports/node.ts',
];

// the `rdap-whois` command, which `publishConfig.bin` points at. Built like the entry points
// but not one of them: nothing imports it, so it gets no type declarations
export const binEntries = ['src/cli.ts'];

// /utils is built on its own, as one file. Its modules are shared with the other entries, so
// with code splitting they land in chunks next to code that imports tldts, punycode and
// ipaddr.js, and a bundler keeps those packages (none is marked free of side effects) for
// any import from /utils, `EPP_STATUS_VALUES` alone included. Nothing /utils loads imports
// them, so on its own it brings none of them. check:pack measures this
const leafEntries = ['src/utils.ts'];

// the published build: ES modules only, for any runtime (Node loads them with require() too,
// from 22.12). The two builds write to one directory at once, so neither cleans it: the
// `build` script empties it first
const shared: Options = {
  format: ['esm'],
  target: 'es2022',
  platform: 'neutral',
  outDir: 'dist',
  sourcemap: true,
  clean: false,
  // the two transports import their runtime's own socket modules, which only exist there.
  // The `node:` prefix is kept: Workers and Deno resolve Node's built-ins only by it
  external: [/^node:/, 'cloudflare:sockets'],
  removeNodeProtocol: false,
};

const splitEntries = entries.filter(entry => !leafEntries.includes(entry));

export default defineConfig([
  // splitting stays on here so what is loaded with a dynamic import() (the WHOIS side, and
  // each runtime's transport) lands in its own chunk, and an RDAP-only or parser-only
  // consumer never pulls it in
  {
    ...shared,
    entry: [...splitEntries, ...binEntries],
    dts: { entry: splitEntries },
    splitting: true,
  },
  { ...shared, entry: leafEntries, dts: { entry: leafEntries }, splitting: false },
]);
