#!/usr/bin/env tsx
// Adds or corrects the WHOIS server for a zone in one step:
//   1. asks the server for a name known to be registered there, and stops unless it
//      answers with a record
//   2. records that answer as a fixture with its golden
//      (fixtures/whois/found/<server>___<name>.txt and .json)
//   3. routes the zone to the server in the hand-kept routing data: data/whois/tlds-extra.json
//      for a zone nothing routes yet, tlds-overrides.json to replace what something else says
//   4. regenerates src/whois/generated/tlds.ts
//   5. prints which of the fields a domain record should have the parser left empty, so a
//      server whose format needs tuning shows it at once
//
// Run: npm run whois:add-server -- <zone> <server> <registered-name>
// e.g. npm run whois:add-server -- example whois.nic.example nic.example
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { normalizeServer } from '../../src/common/utils';
import { DOMAIN_REQUIRED_FIELDS } from '../../src/whois/base';
import { formatConfig } from '../../src/whois/formats';
import { addRawMetadata } from './lib/raw';
import { toolingClient } from '../lib/client';
import { packageScript } from '../lib/run';
import { PACKAGE_DIR, WHOIS_DATA_DIR, WHOIS_FIXTURES_DIR } from '../lib/paths';
import { mergeTldLayers } from './generate-tlds';
import { recordedFixture } from './lib/fixture';

const USAGE = 'Usage: npm run whois:add-server -- <zone> <server> <registered-name>';

type TldMap = Record<string, string | null>;

function readLayer(file: string): TldMap {
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as TldMap) : {};
}

// write a routing layer back sorted, so the diff is one line
function writeLayer(file: string, layer: TldMap): void {
  const sorted = Object.fromEntries(Object.entries(layer).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(file, JSON.stringify(sorted, null, 2) + '\n', 'utf8');
}

async function addServer(zoneArg: string, serverArg: string, name: string): Promise<void> {
  const zone = zoneArg.toLowerCase().replace(/^\.+/, '');
  const server = normalizeServer(serverArg);
  const query = name.toLowerCase();
  if (!query.endsWith(`.${zone}`)) {
    throw new Error(`${query} is not a name inside .${zone}`);
  }

  // 1. the server must answer with a record for a registered name
  const [hop] = await toolingClient().whois(query, { server, followReferrals: 0 });
  if (!hop?.raw) throw new Error(`${server} sent nothing for ${query}; nothing changed`);
  if (hop.status !== 'found') {
    throw new Error(
      `${server} answered ${hop.status} for ${query}; nothing changed. ` +
        'Check the name is registered, or see the response with `npm run who`'
    );
  }

  // 2. the fixture pair
  const raw = addRawMetadata(query, server, new Date().toISOString(), hop.raw);
  const { text, data } = recordedFixture(raw, server);
  const base = `${WHOIS_FIXTURES_DIR}found/${server}___${query}`;
  writeFileSync(`${base}.txt`, text, 'utf8');
  writeFileSync(`${base}.json`, JSON.stringify({ query, server, ...data }, null, 2) + '\n', 'utf8');
  console.log(`recorded fixtures/whois/found/${server}___${query}.txt and .json`);

  // 3. the routing data
  const current = mergeTldLayers()[zone];
  if (current && normalizeServer(current) === server) {
    console.log(`.${zone} already routes to ${server}`);
  } else {
    const layerName = current === undefined ? 'tlds-extra.json' : 'tlds-overrides.json';
    const layerFile = `${WHOIS_DATA_DIR}${layerName}`;
    const layer = readLayer(layerFile);
    layer[zone] = server;
    writeLayer(layerFile, layer);
    const was = current === undefined ? 'nothing' : (current ?? 'no server');
    console.log(`routed .${zone} to ${server} in data/whois/${layerName} (was ${was})`);

    // 4. the generated table
    execSync(packageScript('whois:generate:tlds'), { cwd: PACKAGE_DIR, stdio: 'inherit' });
  }

  // 5. what the parser could not fill
  const missing = DOMAIN_REQUIRED_FIELDS.filter(field => {
    const value = (data as Record<string, unknown>)[field];
    return value === undefined || (Array.isArray(value) && value.length === 0);
  });
  const config = formatConfig(server);
  console.log(
    `parser: ${config ? `its own config (${config.format})` : 'the default format'}; ` +
      `${DOMAIN_REQUIRED_FIELDS.length - missing.length}/${DOMAIN_REQUIRED_FIELDS.length} record fields filled`
  );
  if (missing.length) {
    console.log(`empty: ${missing.join(', ')}`);
    console.log(
      'If the response has these, add src/whois/servers/<server>.ts (see CONTRIBUTING.md), ' +
        'run `npm run whois:generate:servers`, then `npm run whois:regen-goldens -- --server ' +
        `${server}\``
    );
  }
  console.log('Next: `npm test`, then commit the fixture pair and the data diff');
}

const [zone, server, name] = process.argv.slice(2);
if (!zone || !server || !name) {
  console.error(USAGE);
  process.exit(1);
}

addServer(zone, server, name).catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
