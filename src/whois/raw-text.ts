// the raw response text, made ready to parse. Apart from whois/utils because it imports
// html-entities, which /utils must not load: the package is not marked free of side effects
// where its ES modules are, so a bundler would keep all of it for any import from /utils
import { decode } from 'html-entities';

// normalize raw whois result by replacing tabs with spaces and CRLF with LF
export function normalizeRawText(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';
  raw = raw
    .replace(/[\f\v\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, ' ') // Replace other whitespace chars with space
    .replace(/\t/g, ' ') // Replace tabs with space
    .replace(/\r\n|\r|\u2028|\u2029/g, '\n'); // Replace all newline variants with \n

  // decode HTML entities and trim. yes, some whois servers are using HTML entities
  return decode(raw).trim();
}
