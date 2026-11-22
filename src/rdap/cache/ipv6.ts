import ipaddr from 'ipaddr.js';
import ipv6Bootstrap from '../../../data/rdap/ipv6.json';
import { BaseServerCache } from './base';

export class Ipv6ServerCache extends BaseServerCache {
  constructor() {
    // https://data.iana.org/rdap/ipv6.json
    super(ipv6Bootstrap);
  }

  // the server for an address or a CIDR block, by the range holding it, or null for a query
  // that is not an IPv6 address or that no range holds
  getServer(query: string): string | null {
    let address: ipaddr.IPv6;
    try {
      address = query.includes('/') ? ipaddr.IPv6.parseCIDR(query)[0] : ipaddr.IPv6.parse(query);
    } catch {
      return null;
    }
    for (const [pattern, server] of this.entries()) {
      // a range the bootstrap file writes in a form ipaddr.js does not read is passed over
      if (!ipaddr.IPv6.isValidCIDR(pattern)) continue;
      if (address.match(ipaddr.IPv6.parseCIDR(pattern))) return server;
    }
    return null;
  }
}
