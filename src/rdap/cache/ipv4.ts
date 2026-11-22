import ipaddr from 'ipaddr.js';
import ipv4Bootstrap from '../../../data/rdap/ipv4.json';
import { BaseServerCache } from './base';

export class Ipv4ServerCache extends BaseServerCache {
  constructor() {
    // https://data.iana.org/rdap/ipv4.json
    super(ipv4Bootstrap);
  }

  // the server for an address or a CIDR block, by the range holding it, or null for a query
  // that is not an IPv4 address or that no range holds
  getServer(query: string): string | null {
    let address: ipaddr.IPv4;
    try {
      address = query.includes('/') ? ipaddr.IPv4.parseCIDR(query)[0] : ipaddr.IPv4.parse(query);
    } catch {
      return null;
    }
    for (const [pattern, server] of this.entries()) {
      // a range the bootstrap file writes in a form ipaddr.js does not read is passed over
      if (!ipaddr.IPv4.isValidCIDR(pattern)) continue;
      if (address.match(ipaddr.IPv4.parseCIDR(pattern))) return server;
    }
    return null;
  }
}
