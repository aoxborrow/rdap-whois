// The fields of parsed WHOIS data that hold dates. A module of its own so reviveDates() can
// name them without loading the WHOIS parser.
export const DATE_FIELDS: string[] = [
  'creationDate',
  'expirationDate',
  'registrarExpirationDate',
  'updatedDate',
];
