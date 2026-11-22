// Where the package's tooling reads and writes: the WHOIS fixture corpus, the routing data
// the library ships, and the registry-health state and reports. Absolute paths, each with a
// trailing slash
import { fileURLToPath } from 'node:url';

const fromPackage = (relative: string): string =>
  fileURLToPath(new URL(`../../${relative}`, import.meta.url));

// the package root
export const PACKAGE_DIR = fromPackage('');

// the fixture corpus: one raw response per file, with its golden beside it
export const WHOIS_FIXTURES_DIR = fromPackage('fixtures/whois/');

// the routing data: the WHOIS server layers and the RDAP bootstrap files
export const WHOIS_DATA_DIR = fromPackage('data/whois/');
export const RDAP_DATA_DIR = fromPackage('data/rdap/');

// the registry-health state, decisions and reports. Committed, never published
export const HEALTH_DIR = fromPackage('registry-health/');

// the tables the generators write into the library's source
export const GENERATED_DIR = fromPackage('src/whois/generated/');

// the per-TLD pool of names known to be registered, which the probes and sweeps ask for
export const TRANCO_NAMES_FILE = fromPackage('scripts/whois/data/tranco-names.json');
