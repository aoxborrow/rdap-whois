import asnBootstrap from '../../../data/rdap/asn.json';
import { BaseServerCache } from './base';

export class AsnServerCache extends BaseServerCache {
  constructor() {
    // https://data.iana.org/rdap/asn.json
    super(asnBootstrap);
  }

  getServer(query: string): string | null {
    const asnNum = Number(query.replace(/^AS/i, ''));
    for (const [pattern, server] of this.entries()) {
      const [start, end] = pattern.split('-').map(Number);
      if (asnNum >= start && asnNum <= end) {
        return server;
      }
    }
    return null;
  }
}
