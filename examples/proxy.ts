// lookups through proxies. RDAP_WHOIS_PROXY is one proxy for both protocols; WHOIS_PROXY
// and RDAP_PROXY give each protocol its own. A protocol with none goes direct.
// Run: RDAP_WHOIS_PROXY=socks5://user:pass@proxy.example:1080 npx tsx proxy.ts google.com
import { RdapWhois, type ProxyOption } from '@aoxborrow/rdap-whois';

const { RDAP_WHOIS_PROXY, WHOIS_PROXY, RDAP_PROXY } = process.env;
const proxy: ProxyOption | undefined =
  RDAP_WHOIS_PROXY ??
  (WHOIS_PROXY || RDAP_PROXY
    ? {
        ...(WHOIS_PROXY ? { whois: WHOIS_PROXY } : {}),
        // connectTimeout: how long getting a tunnel from the proxy may take
        ...(RDAP_PROXY ? { rdap: { url: RDAP_PROXY, connectTimeout: 5000 } } : {}),
      }
    : undefined);
if (!proxy) {
  console.error(
    'set RDAP_WHOIS_PROXY, or WHOIS_PROXY and RDAP_PROXY, to a socks5://, http:// or https:// URL'
  );
  process.exit(2);
}

const client = new RdapWhois({ proxy });
const name = process.argv[2] ?? 'example.com';
const { query, record, source } = await client.lookup(name);
console.log(query, record.registrar?.name, `(${source.protocol} via ${source.server})`);
