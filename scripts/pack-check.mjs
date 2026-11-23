// Published-shape smoke test.
//
// Inside the monorepo the package is consumed from `src`, so nothing here exercises what a
// consumer of the npm package gets. This builds `dist`, packs the tarball the way a release
// would, unpacks it, and then:
//   - imports every entry through the published `exports` map, with `import` and with
//     Node's require() of an ES module, and require()s every built module on its own, which
//     fails on a top-level await anywhere in the build
//   - checks every Node built-in the build imports is named with `node:`
//   - bundles every entry from the tarball for Workers and for a browser, as wrangler and a
//     browser bundler would, with only `node:*` and `cloudflare:sockets` left external
//
// Run: `npm run check:pack` (wired into CI).
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { builtinModules } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, stdio: 'pipe' }).toString();

const work = mkdtempSync(join(tmpdir(), 'rdap-whois-pack-'));
try {
  // packed by the package manager that runs this check. Yarn applies `publishConfig` when it
  // packs, which is what points the monorepo's source exports at dist
  const tarball = join(work, 'package.tgz');
  if ((process.env.npm_config_user_agent ?? '').startsWith('yarn')) {
    run('yarn', ['build']);
    run('yarn', ['pack', '--out', tarball]);
  } else {
    run('npm', ['run', 'build']);
    const packed = run('npm', ['pack', '--silent', '--pack-destination', work]).trim();
    renameSync(join(work, packed.split('\n').pop()), tarball);
  }

  // unpack where Node will resolve it by name
  const name = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name;
  const target = join(work, 'node_modules', ...name.split('/'));
  mkdirSync(target, { recursive: true });
  run('tar', ['-xzf', tarball, '-C', target, '--strip-components=1']);

  const manifest = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'));
  const subpaths = Object.keys(manifest.exports ?? {});
  const entrySubpaths = subpaths.filter(subpath => subpath !== './package.json');
  for (const subpath of entrySubpaths) {
    const entry = manifest.exports[subpath];
    if (!entry?.default?.startsWith('./dist/') || !entry?.types?.startsWith('./dist/')) {
      throw new Error(`the packed package.json does not point ${subpath} at dist`);
    }
  }
  if (manifest.exports['./package.json'] !== './package.json') {
    throw new Error('the packed package.json does not export ./package.json');
  }
  // what a release must carry, and what it must not
  for (const file of ['LICENSE', 'README.md', 'CHANGELOG.md']) {
    if (!existsSync(join(target, file))) throw new Error(`the tarball has no ${file}`);
  }
  for (const dir of ['fixtures', 'test', 'scripts', 'registry-health', 'src', 'data']) {
    if (existsSync(join(target, dir))) throw new Error(`the tarball includes ${dir}/`);
  }
  // every file in it is one `files` names, or one a package manager always adds
  const always = ['package.json', 'README.md', 'LICENSE', 'CHANGELOG.md'];
  // a leading slash anchors an entry at the package root
  const listed = (manifest.files ?? []).map(entry => entry.replace(/^\//, ''));
  const stray = run('tar', ['-tzf', tarball])
    .split('\n')
    .filter(line => line && !line.endsWith('/'))
    .map(line => line.replace(/^package\//, ''))
    .filter(
      file =>
        !always.includes(file) &&
        !listed.some(entry => file === entry || file.startsWith(`${entry}/`))
    );
  if (stray.length) throw new Error(`the tarball has files outside \`files\`: ${stray.join(', ')}`);

  // a consumer's install would put the package's dependencies beside it. Link the ones this
  // workspace already has, so the import below resolves them the same way
  for (const dependency of Object.keys(manifest.dependencies ?? {})) {
    const installed = [join(root, 'node_modules'), join(root, '..', '..', 'node_modules')]
      .map(dir => join(dir, ...dependency.split('/')))
      .find(dir => existsSync(dir));
    if (!installed) throw new Error(`dependency ${dependency} is not installed`);
    const link = join(work, 'node_modules', ...dependency.split('/'));
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(installed, link, 'dir');
  }

  // every built module, and every Node built-in it imports by a bare name
  const builtFiles = readdirSync(join(target, 'dist'), { recursive: true })
    .map(String)
    .filter(file => file.endsWith('.js'));
  const bare = new Set(builtinModules.filter(module => !module.startsWith('_')));
  for (const file of builtFiles) {
    const code = readFileSync(join(target, 'dist', file), 'utf8');
    for (const [, specifier] of code.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g)) {
      if (bare.has(specifier)) {
        throw new Error(`dist/${file} imports the Node built-in "${specifier}" without node:`);
      }
    }
  }

  // what require() can load on Node: not the Workers transport, which imports a module only
  // Workers has, and not the command, which runs when it is loaded
  const commands = Object.values(manifest.bin ?? {}).map(file => file.replace(/^\.\/dist\//, ''));
  const nodeLoadable = builtFiles.filter(
    file =>
      !commands.includes(file) &&
      !readFileSync(join(target, 'dist', file), 'utf8').includes('cloudflare:sockets')
  );

  // import every entry point the way a consumer would, with import and with require()
  const check = `
    if (typeof m.RdapWhoisError !== 'function') throw new Error('RdapWhoisError is not exported');
    const e = new m.TimeoutError('t');
    if (!(e instanceof m.RdapWhoisError) || e.name !== 'TimeoutError' || e.retryable) throw new Error('bad error class');
    if (typeof m.RdapWhois !== 'function') throw new Error('RdapWhois is not exported');
    if (typeof new m.RdapWhois().whois !== 'function') throw new Error('bad client');
    if ('Rdap' in m || 'Whois' in whois) throw new Error('the protocol-only clients are still exported');
    for (const call of ['lookup', 'whois', 'rdap']) if (typeof m[call] !== 'function') throw new Error(call + '() is not exported');
    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(m.DATA_VERSION?.rdapBootstrap)) throw new Error('DATA_VERSION is not exported');
    // IP and AS routing reads the bootstrap ranges through ipaddr.js, a CommonJS dependency
    if (!m.getRdapServer('ip', '8.8.8.8')?.includes('arin.net')) throw new Error('the root does not route an IPv4 address');
    if (!m.getRdapServer('ip', '2001:4860::8888')?.includes('arin.net')) throw new Error('the root does not route an IPv6 address');
    if (!m.getRdapServer('domain', 'example.com')?.includes('verisign')) throw new Error('the root does not route a domain');
    if (typeof whois.parseWhois !== 'function') throw new Error('bad /whois');
    if (whois.parseWhois('Domain Name: EXAMPLE.COM', 'whois.verisign-grs.com').data?.domainName !== 'example.com') throw new Error('parseWhois does not parse');
    // a server the target policy refuses is thrown before anything connects, and the WHOIS
    // side, loaded on demand, throws the root's error classes
    new m.RdapWhois().whois('example.com', { server: '127.0.0.1' }).then(
      () => { throw new Error('whois() asked a refused server'); },
      error => { if (!(error instanceof m.BlockedTargetError)) throw new Error("the WHOIS side does not throw the root's error classes"); }
    );
    if (utils.getCountryName('DE') !== 'Germany') throw new Error('bad /utils');
    if (typeof node.createConnect !== 'function') throw new Error('bad /transports/node');
  `;
  const modules = {
    m: '',
    whois: '/whois',
    utils: '/utils',
    node: '/transports/node',
  };
  if (
    Object.values(modules).sort().join() !==
    entrySubpaths
      .map(s => s.slice(1))
      .sort()
      .join()
  ) {
    throw new Error(`the check does not cover every entry point: ${entrySubpaths.join(', ')}`);
  }
  const imports = Object.entries(modules);
  writeFileSync(
    join(work, 'esm.mjs'),
    imports.map(([id, sub]) => `import * as ${id} from '${name}${sub}';`).join('\n') + check
  );
  writeFileSync(
    join(work, 'cjs.cjs'),
    imports.map(([id, sub]) => `const ${id} = require('${name}${sub}');`).join('\n') +
      `
    // require() of an ES module fails on a top-level await (ERR_REQUIRE_ASYNC_MODULE), so
    // loading each built module on its own covers the chunks loaded only by import() too.
    // This runs before the check below, whose calls start loading some of them with import()
    for (const file of ${JSON.stringify(nodeLoadable)}) require(${JSON.stringify(join(target, 'dist'))} + '/' + file);
    if (require('${name}/package.json').name !== '${name}') throw new Error('bad ./package.json export');
  ` +
      check
  );
  run('node', ['esm.mjs'], work);
  run('node', ['cjs.cjs'], work);

  // bundle every entry from the tarball for Workers and for a browser
  for (const [platform, conditions] of [
    ['workerd', ['workerd', 'worker', 'browser']],
    ['browser', ['browser']],
  ]) {
    try {
      await build({
        stdin: {
          contents: imports
            .map(([id, sub]) => `export * as ${id} from '${name}${sub}';`)
            .join('\n'),
          resolveDir: work,
        },
        bundle: true,
        write: false,
        outdir: join(work, `bundle-${platform}`),
        format: 'esm',
        splitting: true,
        platform: 'browser',
        conditions,
        external: ['node:*', 'cloudflare:sockets'],
        logLevel: 'silent',
      });
    } catch (error) {
      throw new Error(
        `the packed package does not bundle for ${platform}: ${error.errors?.map(e => e.text).join('; ') ?? error.message}`,
        { cause: error }
      );
    }
  }

  // /utils is a leaf, built without shared chunks, so one constant from it costs about that
  // much. When it shared a chunk with the network code, EPP_STATUS_VALUES alone cost 149 kB:
  // tldts, punycode, ipaddr.js and html-entities, which bundlers keep once anything imports
  // them because none is marked free of side effects
  const leaf = await build({
    stdin: { contents: `export { EPP_STATUS_VALUES } from '${name}/utils';`, resolveDir: work },
    bundle: true,
    minify: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    logLevel: 'silent',
  });
  const leafKilobytes = leaf.outputFiles[0].contents.length / 1024;
  if (leafKilobytes > 10) {
    throw new Error(
      `importing EPP_STATUS_VALUES alone from /utils bundles to ${leafKilobytes.toFixed(1)} kB (at most 10 kB)`
    );
  }

  // the command: declared in the packed manifest, and it starts
  const bin = manifest.bin?.['rdap-whois'];
  if (!bin || !existsSync(join(target, bin))) {
    throw new Error('the packed package.json has no rdap-whois command, or its file is missing');
  }
  if (!run('node', [join(target, bin), '--help'], work).includes('usage: rdap-whois')) {
    throw new Error('the rdap-whois command does not print its usage');
  }
  if (run('node', [join(target, bin), '--version'], work).trim() !== manifest.version) {
    throw new Error('rdap-whois --version does not print the package version');
  }

  const kilobytes = Math.round(statSync(tarball).size / 1024);
  console.log(
    `✓ ${name} packs (${kilobytes} kB), loads with import and require(), bundles for Workers and browsers, and its command runs.`
  );
} catch (error) {
  console.error('✗ the packed package does not import cleanly.');
  console.error(error.stderr?.toString() || error.message);
  process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
