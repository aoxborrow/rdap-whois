// parse a WHOIS response you already have, with no network: here Verisign's answer for
// google.com, saved beside this file. Run: npx tsx parse-only.ts
import { readFileSync } from 'node:fs';
import { parseWhois } from '@aoxborrow/rdap-whois/whois';

const raw = readFileSync(new URL('./google.com.whois.txt', import.meta.url), 'utf8');
// the server picks that server's format
const { status, data } = parseWhois(raw, 'whois.verisign-grs.com');

if (status !== 'found' || !data || !('domainName' in data)) {
  throw new Error(`expected a domain record, got status ${status}`);
}
console.log(data.domainName, 'with', data.registrarName);
console.log('expires', data.expirationDate?.toISOString());
console.log('statuses', data.eppStatus?.join(', '));
console.log('nameservers', data.nameservers?.join(', '));
console.log('registrar WHOIS', data.registrarWhoisServer);
