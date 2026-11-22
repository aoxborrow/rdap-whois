#!/usr/bin/env node
// The `rdap-whois` command: one lookup, printed as JSON.
//
//   rdap-whois example.com                  the combined record (RDAP first, WHOIS behind it)
//   rdap-whois example.com --verbose        the same, with every server's answer and the merge
//   rdap-whois example.com --whois          every WHOIS server's answer, registry then registrar
//   rdap-whois 8.8.8.8 --rdap               every RDAP server's answer
//   rdap-whois example.com --whois --raw    the response text only
//
// Options: --server <host or URL>, --referrals <n>, --timeout <ms>, --proxy <url>. Without
// --proxy, the RDAP_WHOIS_PROXY environment variable is the proxy, which keeps its
// credentials out of the shell's history. A query that is not a domain name (an IP address,
// an AS number, an entity handle) is looked up over RDAP unless --whois is given, since
// lookup() takes domain names only.
import { RdapWhois } from './index';
import { detectQueryType } from './query';
import { VERSION } from './version';

const USAGE = `usage: rdap-whois <query> [--whois | --rdap] [--raw] [--verbose] [--server <server>]
                  [--referrals <n>] [--timeout <ms>] [--proxy <url>]
       rdap-whois -h | --help | --version

The proxy defaults to the RDAP_WHOIS_PROXY environment variable.`;

interface Args {
  query: string;
  mode: 'lookup' | 'whois' | 'rdap';
  raw: boolean;
  verbose: boolean;
  server?: string;
  referrals?: number;
  timeout?: number;
  proxy?: string;
}

const VALUE_FLAGS = new Set(['--server', '--referrals', '--timeout', '--proxy']);

// what the command was asked to do: a lookup, or to print its usage or version. A string is
// a mistake in the arguments, to print with the usage
function parseArgs(argv: string[], env: NodeJS.ProcessEnv): Args | 'help' | 'version' | string {
  const values: Record<string, string> = {};
  const flags = new Set<string>();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (VALUE_FLAGS.has(arg)) {
      const value = argv[++i];
      if (value === undefined) return `${arg} needs a value`;
      values[arg] = value;
    } else if (arg.startsWith('--') || arg === '-h') {
      flags.add(arg === '-h' ? '--help' : arg);
    } else {
      positional.push(arg);
    }
  }
  const unknown = [...flags].filter(
    flag => !['--whois', '--rdap', '--raw', '--verbose', '--help', '--version'].includes(flag)
  );
  if (flags.has('--help')) return 'help';
  if (flags.has('--version')) return 'version';
  if (unknown.length) return `unknown option ${unknown[0]}`;
  if (positional.length !== 1) return 'give one query';
  if (flags.has('--whois') && flags.has('--rdap')) return 'give --whois or --rdap, not both';

  const query = positional[0];
  const number = (flag: string) => (values[flag] === undefined ? undefined : Number(values[flag]));
  const mode = flags.has('--whois')
    ? 'whois'
    : flags.has('--rdap') || detectQueryType(query) !== 'domain'
      ? 'rdap'
      : 'lookup';
  const args: Args = {
    query,
    mode,
    raw: flags.has('--raw'),
    verbose: flags.has('--verbose'),
    server: values['--server'],
    referrals: number('--referrals'),
    timeout: number('--timeout'),
    proxy: values['--proxy'] ?? (env.RDAP_WHOIS_PROXY || undefined),
  };
  for (const flag of ['--referrals', '--timeout'] as const) {
    const value = number(flag);
    if (value !== undefined && !(Number.isInteger(value) && value >= 0)) {
      return `${flag} must be a whole number`;
    }
  }
  if (args.server && mode === 'lookup') return '--server needs --whois or --rdap';
  if (args.verbose && mode !== 'lookup') return '--verbose is for a domain lookup';
  return args;
}

function print(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2), process.env);
  if (args === 'help') {
    process.stdout.write(USAGE + '\n');
    return 0;
  }
  if (args === 'version') {
    process.stdout.write(VERSION + '\n');
    return 0;
  }
  if (typeof args === 'string') {
    process.stderr.write(`rdap-whois: ${args}\n` + USAGE + '\n');
    return 2;
  }

  const client = new RdapWhois({
    ...(args.timeout !== undefined ? { timeout: args.timeout } : {}),
    ...(args.referrals !== undefined ? { followReferrals: args.referrals } : {}),
    ...(args.proxy ? { proxy: args.proxy } : {}),
  });

  try {
    if (args.mode === 'lookup') {
      print(await client.lookup(args.query, { verbose: args.verbose }));
    } else {
      const call = { ...(args.server ? { server: args.server } : {}) };
      const hops =
        args.mode === 'whois'
          ? await client.whois(args.query, call)
          : await client.rdap(args.query, call);
      if (args.raw) {
        for (const hop of hops) {
          const text = 'raw' in hop ? hop.raw : JSON.stringify(hop.data, null, 2);
          process.stdout.write(`### ${hop.server}\n${text ?? ''}\n`);
        }
      } else {
        print(hops);
      }
    }
    return 0;
  } catch (error) {
    const name = error instanceof Error ? error.name : 'Error';
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`rdap-whois: ${name}: ${message}\n`);
    return 1;
  }
}

main().then(
  code => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`rdap-whois: ${String(error)}\n`);
    process.exitCode = 1;
  }
);
