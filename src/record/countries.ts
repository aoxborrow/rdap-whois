import { ALPHA3_TO_ALPHA2, COUNTRY_NAMES } from './generated/countries';

/** valid ISO 3166-1 alpha-2 country codes */
export type CountryCode = keyof typeof COUNTRY_NAMES;

export const COUNTRY_CODES: readonly CountryCode[] = Object.keys(COUNTRY_NAMES) as CountryCode[];

// every English name and alternate name, lower-cased, to its code. Where two countries share
// a name the first in the table keeps it. Built the first time a name is looked up
let byName: Map<string, CountryCode> | undefined;
function codeForName(name: string): CountryCode | undefined {
  if (!byName) {
    byName = new Map();
    for (const code of COUNTRY_CODES) {
      for (const each of COUNTRY_NAMES[code]) {
        const key = each.toLowerCase();
        if (!byName.has(key)) byName.set(key, code);
      }
    }
  }
  return byName.get(name.toLowerCase());
}

const nameOf = (code: string): string | undefined =>
  (COUNTRY_NAMES as Record<string, readonly string[]>)[code]?.[0];

/**
 * normalize country input to ISO 3166-1 alpha-2 code
 * handles various input formats:
 * - 2-letter codes (US, FR, DE)
 * - 3-letter codes (USA, FRA, DEU)
 * - full country names (United States, France, Germany)
 * - common variations and edge cases
 */
export function parseCountryCode(input: string | null | undefined): CountryCode | null {
  if (!input || typeof input !== 'string') {
    return null;
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  // handle privacy redaction
  if (trimmed.toUpperCase().includes('REDACTED') || trimmed.toUpperCase().includes('PRIVACY')) {
    return null;
  }

  // try as 2-letter code first (most common in whois)
  if (trimmed.length === 2) {
    const upper = trimmed.toUpperCase();
    // check if it's valid by trying to get the name, but make sure it's not numeric
    if (/^[A-Z]{2}$/.test(upper) && nameOf(upper)) {
      return upper as CountryCode;
    }
  }

  // try as 3-letter code
  if (trimmed.length === 3) {
    const upper = trimmed.toUpperCase();
    const alpha2 = ALPHA3_TO_ALPHA2[upper];
    if (alpha2) {
      return alpha2 as CountryCode;
    }
  }

  // try as full country name
  const alpha2FromName = codeForName(trimmed);
  if (alpha2FromName) {
    return alpha2FromName;
  }

  // try common variations and edge cases
  const normalized = normalizeCountryName(trimmed);
  if (normalized) {
    const alpha2 = codeForName(normalized);
    if (alpha2) {
      return alpha2;
    }
  }

  // if all else fails, check if it's already a valid 2-letter code (case insensitive)
  const upperInput = trimmed.toUpperCase();
  if (upperInput.length === 2 && /^[A-Z]{2}$/.test(upperInput) && nameOf(upperInput)) {
    return upperInput as CountryCode;
  }

  return null;
}

// normalize country names to handle common variations
function normalizeCountryName(name: string): string | null {
  const lower = name.toLowerCase().trim();

  // common country name variations
  const variations: Record<string, string> = {
    // united states variations
    'usa': 'United States',
    'united states of america': 'United States',
    'us': 'United States',
    'america': 'United States',

    // united kingdom variations
    'uk': 'United Kingdom',
    'great britain': 'United Kingdom',
    'britain': 'United Kingdom',
    'england': 'United Kingdom',

    // other common variations
    'russia': 'Russian Federation',
    'south korea': 'Korea, Republic of',
    'north korea': "Korea, Democratic People's Republic of",
    'taiwan': 'Taiwan, Province of China',
    'hong kong': 'Hong Kong',
    'macau': 'Macao',
    'vatican': 'Holy See (Vatican City State)',
    'iran': 'Iran, Islamic Republic of',
    'syria': 'Syrian Arab Republic',
    'venezuela': 'Venezuela, Bolivarian Republic of',
    'bolivia': 'Bolivia, Plurinational State of',
    'moldova': 'Moldova, Republic of',
    'macedonia': 'North Macedonia',
    'czech republic': 'Czechia',
    'ivory coast': "Côte d'Ivoire",
    'cape verde': 'Cabo Verde',
    'east timor': 'Timor-Leste',
    'burma': 'Myanmar',
    'swaziland': 'Eswatini',

    // german variations
    'deutschland': 'Germany',

    // dutch variations
    'nederland': 'Netherlands',
    'holland': 'Netherlands',

    // other european variations
    'österreich': 'Austria',
    'schweiz': 'Switzerland',
    'suisse': 'Switzerland',
    'svizzera': 'Switzerland',
    'belgië': 'Belgium',
    'belgique': 'Belgium',
    'polska': 'Poland',
    'česká republika': 'Czechia',
    'slovensko': 'Slovakia',
  };

  const normalized = variations[lower];
  if (normalized) {
    return normalized;
  }

  // capitalize first letter of each word for proper names
  return name
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** get country name from 2-letter code */
export function getCountryName(code: CountryCode | null): string | null {
  if (!code) {
    return null;
  }

  return nameOf(code) ?? null;
}

/** validate if a string is a valid ISO 3166-1 alpha-2 country code */
export function isValidCountryCode(code: string): code is CountryCode {
  return code.length === 2 && /^[A-Z]{2}$/.test(code) && nameOf(code) !== undefined;
}
