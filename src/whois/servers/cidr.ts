// .as/.je/.gg (CIDR) — labeled-blocks with BARE bodies that contain colons (`http://` url,
// `at 00:00:00` time); bareBodyHeaders keeps each body line whole. blockFields route the
// bare value, valueExtract strips the date phrase/ordinal and the ` (url)` off the
// registrar name.
import type { FormatConfig } from '../formats';

export const cidr: FormatConfig = {
  format: 'labeled-blocks',
  bareBodyHeaders: ['Registrant', 'Registrar', 'Relevant dates', 'Domain'],
  blockScopes: { registrant: 'registrant' },
  blockFields: {
    'domain': 'domainName',
    // the registrant line is a person's name for some domains and an organisation for others
    // — emit both.
    'registrant': 'registrantName+registrantOrg',
    // `MarkMonitor Inc. (http://www.markmonitor.com)` carries the name AND the url on one
    // bare line — fan to both, then value-extract splits the name off from the parenthetical.
    'registrar': 'registrarName+registrarUrl',
    'relevant dates': 'creationDate',
    'name servers': 'nameservers',
  },
  valueExtract: {
    // `Registered on 26th February 2015 at 22:52:30.894` → `26 February 2015 at 22:52:30.894`:
    // strip the `Registered on` prefix + the ordinal, but KEEP the `at <time>` (.gg carries a
    // full timestamp the date formatter reads; .as/.je are date-only and the optional group is
    // simply absent).
    creationDate: ['.*?(\\d{1,2})(?:st|nd|rd|th)? (\\w+ \\d{4}(?: at [\\d:.]+)?).*', '$1 $2'],
    registrarName: [' *\\(.*', ''],
    registrarUrl: ['^[^(]*\\((https?://[^)]+)\\).*$', '$1'],
  },
};
