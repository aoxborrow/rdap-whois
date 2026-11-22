#!/usr/bin/env tsx
// Refresh the committed IANA RDAP bootstrap files (data/rdap/*.json). The bootstrap
// loads at import time in src/tools/rdap, so prod only picks up changes on a deploy.
//
// Run:  npm run rdap:update          # download + overwrite
//       npm run rdap:update --diff   # report drift, write nothing
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { RDAP_DATA_DIR } from '../lib/paths';

// get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// rdap file urls
const RDAP_URLS: Record<string, string> = {
  'dns': 'https://data.iana.org/rdap/dns.json',
  'ipv4': 'https://data.iana.org/rdap/ipv4.json',
  'ipv6': 'https://data.iana.org/rdap/ipv6.json',
  'asn': 'https://data.iana.org/rdap/asn.json',
  'object-tags': 'https://data.iana.org/rdap/object-tags.json',
};

// resolve relative to this script so it works from any cwd (scripts/ → ../data/rdap)
const DATA_DIR = RDAP_DATA_DIR;

// IANA bootstrap file shape (RFC 7484; object-tags per RFC 8521 has 3-element services)
type BootstrapFile = {
  version: string;
  publication: string;
  services: string[][][];
};

async function fetchBootstrap(url: string): Promise<BootstrapFile> {
  const response = await fetch(url, {
    headers: { accept: 'application/json,application/rdap+json' },
  });
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as BootstrapFile;
}

// flatten a bootstrap's services into key → sorted server URLs. Regular files are
// [keys, urls] pairs; object-tags entries are [maintainers, tags, urls] triplets.
function serviceMap(bootstrap: BootstrapFile): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of bootstrap.services ?? []) {
    const [keys, urls] = entry.length === 3 ? [entry[1], entry[2]] : [entry[0], entry[1]];
    const urlSet = [...urls].sort().join(' ');
    for (const key of keys) {
      map.set(key.toLowerCase(), urlSet);
    }
  }
  return map;
}

function loadCommitted(name: string): BootstrapFile | null {
  const filePath = path.join(DATA_DIR, `${name}.json`);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as BootstrapFile;
}

// report drift between the committed bootstrap files and IANA's current ones
async function diffRdapFiles(): Promise<void> {
  for (const [name, url] of Object.entries(RDAP_URLS)) {
    const fetched = await fetchBootstrap(url);
    const committed = loadCommitted(name);
    if (!committed) {
      console.log(`\n## ${name}: no committed file (all ${fetched.services.length} services new)`);
      continue;
    }

    const fresh = serviceMap(fetched);
    const stale = serviceMap(committed);
    const added = [...fresh.keys()].filter(key => !stale.has(key));
    const removed = [...stale.keys()].filter(key => !fresh.has(key));
    const changed = [...fresh.keys()].filter(
      key => stale.has(key) && stale.get(key) !== fresh.get(key)
    );

    console.log(`\n## ${name}: publication ${committed.publication} → ${fetched.publication}`);
    console.log(
      `   entries: ${stale.size} → ${fresh.size} (+${added.length} added, −${removed.length} removed, ~${changed.length} changed)`
    );
    // full detail for dns (TLD names are the point); samples for the rest
    const detail = name === 'dns' ? Infinity : 10;
    const show = (label: string, keys: string[]) => {
      if (!keys.length) return;
      const shown = keys.slice(0, detail);
      const more = keys.length - shown.length;
      console.log(`   ${label}: ${shown.join(', ')}${more > 0 ? ` (+${more} more)` : ''}`);
    };
    show('added', added);
    show('removed', removed);
    show('changed', changed);
  }
  console.log('\n(diff only — run without --diff to write the refreshed files)');
}

// download a single file
const downloadFile = async (url: string, filePath: string): Promise<void> => {
  const data = await fetchBootstrap(url);
  await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2));
  console.log(`Successfully downloaded ${url} to ${filePath}`);
};

// main function to download all rdap files
const downloadRdapFiles = async (): Promise<void> => {
  const stats = await fs.promises.stat(DATA_DIR).catch(() => null);
  if (!stats?.isDirectory()) {
    throw new Error(`Target directory does not exist: ${DATA_DIR}`);
  }

  // download all files
  const downloadPromises = Object.entries(RDAP_URLS).map(([name, url]) => {
    const filePath = path.join(DATA_DIR, `${name}.json`);
    return downloadFile(url, filePath);
  });

  await Promise.all(downloadPromises);
  console.log('All RDAP files downloaded successfully!');
};

const run = process.argv.includes('--diff') ? diffRdapFiles : downloadRdapFiles;
run().then(
  () => process.exit(0),
  error => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
);
