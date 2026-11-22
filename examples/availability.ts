// check many names at once. Results arrive as each lookup finishes, and each registry is
// asked within its own limit. Run: npx tsx availability.ts example.com example.org example.net
import { RdapWhois, RdapWhoisError } from '@aoxborrow/rdap-whois';

const names = process.argv.slice(2);
const client = new RdapWhois({ batchConcurrency: 8 });
const retryLater: string[] = [];

for await (const item of client.lookupMany(names)) {
  if (item.ok) {
    const { record } = item.result;
    console.log(
      item.query,
      record.available ? 'available' : record.reserved ? 'reserved' : 'registered'
    );
  } else if (item.error instanceof RdapWhoisError && item.error.retryable) {
    retryLater.push(item.query);
  } else {
    console.log(
      item.query,
      'failed:',
      item.error instanceof Error ? item.error.message : item.error
    );
  }
}
if (retryLater.length) console.log('try again later:', retryLater.join(' '));
