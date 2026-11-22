// the registrable domain: the name a registry holds, which lookup() asks about when it is
// given a host under it
import { parse } from 'tldts';
import { normalizeQuery, isDomainShaped } from './query';
import { getRdapSubZones } from './rdap/servers';
import { REGISTRY_ZONES } from './whois/generated/zones';

// the zones below a TLD the routing data has a registry for, built the first time a name is
// reduced. The public suffix list leaves some out (ac.ru, gov.scot, uk.com), and each of
// them is a registry of its own, holding the names one label below it
let zones: Set<string> | undefined;
const routedZones = (): Set<string> =>
  (zones ??= new Set([...REGISTRY_ZONES, ...getRdapSubZones()]));

/**
 * the registrable domain of a name: its longest suffix among the ICANN public suffixes and
 * the routing data's own registry zones, plus one label. `www.bbc.co.uk` is `bbc.co.uk`,
 * `www.msu.ac.ru` is `msu.ac.ru`. Null when the name is a suffix itself (`co.uk`, `com`)
 * or is not shaped like a domain name. A TLD nobody runs counts as a suffix
 */
export function registrableDomain(name: string): string | null {
  if (!isDomainShaped(name)) return null;
  const text = normalizeQuery(name, 'domain');
  const labels = text.split('.');
  let suffix = parse(text, { allowPrivateDomains: false }).publicSuffix ?? labels.at(-1)!;
  const routed = routedZones();
  for (let i = 0; i < labels.length - 1; i++) {
    const zone = labels.slice(i).join('.');
    if (routed.has(zone)) {
      if (zone.length > suffix.length) suffix = zone;
      break;
    }
  }
  if (text === suffix || !text.endsWith(`.${suffix}`)) return null;
  const below = text.slice(0, -suffix.length - 1).split('.');
  return `${below.at(-1)}.${suffix}`;
}
