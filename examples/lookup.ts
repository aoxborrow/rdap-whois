// one lookup on the shared default client: what the record says, and failures told apart
// by class. Run: npx tsx lookup.ts google.com
import { lookup, NoServerError, NoUsableAnswerError, RdapWhoisError } from '@aoxborrow/rdap-whois';

const name = process.argv[2] ?? 'example.com';

try {
  const { query, record, source } = await lookup(name);
  if (record.available) {
    console.log(`${query} is available (said by ${source.server})`);
  } else if (record.reserved) {
    console.log(`${query} is reserved by its registry`);
  } else {
    console.log(`${query}: registered with ${record.registrar?.name ?? 'an unnamed registrar'}`);
    console.log(`  created  ${record.creationDate?.toISOString() ?? 'unknown'}`);
    console.log(`  expires  ${record.expirationDate?.toISOString() ?? 'unknown'}`);
    console.log(`  servers  ${record.nameservers.join(', ') || 'none'}`);
    console.log(`  answered by ${source.server} over ${source.protocol}`);
  }
} catch (error) {
  if (error instanceof NoServerError) console.error(`no RDAP or WHOIS server is known for ${name}`);
  else if (error instanceof NoUsableAnswerError)
    console.error('the servers answered, but with nothing usable');
  else if (error instanceof RdapWhoisError)
    console.error(`${error.name}: ${error.message} (retryable: ${error.retryable})`);
  else throw error;
  process.exitCode = 1;
}
