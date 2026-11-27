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

// the resolved routing table the generator writes from those layers and the library reads
export const TLDS_FILE = fromPackage('data/tlds.json');

// the registry-health state, decisions and reports. Committed, never published
export const HEALTH_DIR = fromPackage('registry-health/');

// the registrar server list: every accredited registrar's RDAP base and WHOIS server. Tooling
// data, never built into the library
export const REGISTRARS_FILE = fromPackage('registry-health/registrars.json');

// the tables the generators write into the library's source
export const GENERATED_DIR = fromPackage('src/whois/generated/');

// the generated modules both protocols read, outside src/whois/ and src/rdap/
export const SHARED_GENERATED_DIR = fromPackage('src/generated/');

// the per-TLD pool of names known to be registered, which the probes and sweeps ask for
export const TRANCO_NAMES_FILE = fromPackage('scripts/whois/data/tranco-names.json');
