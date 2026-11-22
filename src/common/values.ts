// value helpers with no dependencies. They are apart from common/utils, which imports tldts,
// punycode and ipaddr.js, so that what /utils loads stays free of those packages: none of
// them is marked free of side effects, so a bundler keeps all of each once it is imported

// check for empty values: undefined, null, empty string, empty array, 0, false, NaN, empty objects
export function isEmpty(value: unknown): boolean {
  if (!value) {
    return true;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' || trimmed === 'null' || trimmed === 'undefined';
  }
  if (Array.isArray(value)) {
    return value.length === 0 || value.every(v => isEmpty(v));
  }
  // a Date has no own keys, so it has to be asked directly
  if (value instanceof Date) {
    return Number.isNaN(value.getTime());
  }
  if (typeof value === 'object') {
    return Object.keys(value).length === 0;
  }
  return false;
}

// convert a string to title case
export const titleCase = (string: string) => {
  return string
    .trim()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};
