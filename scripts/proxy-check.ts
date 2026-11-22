// `npm run proxy:check`: the address requests leave from
// through each side of the tooling's proxy (scripts/lib/client.ts), and one real lookup
// over each protocol to show the tunnels carry them
import { createProxyFetch } from '../src/net/proxy-fetch';
import { parseProxy } from '../src/net/proxy';
import { openConnection } from '../src/net/tunnel';
import { connect } from '../src/transports/node';
import { describeProxy, toolingClient, toolingProxy } from './lib/client';

const IP_INFO = 'https://ipinfo.io/json';

type Egress = { ip?: string; org?: string; country?: string };

// the address a request leaves from through one side of the proxy
async function egress(protocol: 'whois' | 'rdap'): Promise<Egress> {
  const spec = toolingProxy(protocol);
  if (!spec) throw new Error('no proxy is configured (see scripts/lib/client.ts)');
  const proxy = parseProxy(spec);
  const proxyFetch = createProxyFetch({
    open: (target, signal) => openConnection(target, { connect, proxy, timeout: 10_000, signal }),
    timeout: 10_000,
    maxResponseBytes: 100_000,
  });
  const response = await proxyFetch(IP_INFO, { headers: { Accept: 'application/json' } });
  return (await response.json()) as Egress;
}

const describe = (egress: Egress) =>
  [egress.ip, egress.org, egress.country].filter(Boolean).join(' ');

async function main(): Promise<void> {
  const direct = (await (await fetch(IP_INFO)).json()) as Egress;
  const whoisSide = await egress('whois');
  console.log(`whois via ${describeProxy('whois')}: ${describe(whoisSide)}`);
  const rdapSide = await egress('rdap');
  console.log(`rdap via ${describeProxy('rdap')}: ${describe(rdapSide)}`);
  const away = whoisSide.ip !== direct.ip && rdapSide.ip !== direct.ip;
  console.log(`leaves from the proxy, not from here: ${away ? 'yes' : 'NO'}`);

  const client = toolingClient();
  const [whoisHop] = await client.whois('example.com', { followReferrals: 0 });
  console.log(`whois example.com via ${whoisHop?.server}: ${whoisHop?.status}`);
  const [rdapHop] = await client.rdap('example.com', { followReferrals: 0 });
  console.log(`rdap example.com via ${rdapHop?.server}: ${rdapHop?.status}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
