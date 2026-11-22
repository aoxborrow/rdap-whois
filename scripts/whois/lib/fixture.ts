// A freshly fetched WHOIS response as it goes into the fixture corpus: the text the server
// sent, with only the echoed request address replaced (see request-address.ts), and the
// golden built from that text, so the pair on disk always agrees.
import { parseBlocks } from '../../../src/whois/mapping';
import { DOMAIN_QUERY_TYPE } from '../../../src/common/constants';
import { goldenData, isEmpty } from '../compare';
import { stripRawMetadata } from './raw';
import { parsesTheSame, replaceRequestAddresses } from './request-address';

export function recordedFixture(
  raw: string,
  server: string
): { text: string; data: Record<string, unknown> } {
  const { text } = replaceRequestAddresses(raw);
  if (!parsesTheSame(raw, text, server)) {
    throw new Error('replacing the request address changed what the response parses to');
  }
  // the golden in the corpus's form: dates as written, empty fields left out
  const parsed = goldenData(
    parseBlocks(stripRawMetadata(text), server, DOMAIN_QUERY_TYPE).data as unknown as Record<
      string,
      unknown
    >
  );
  const data = Object.fromEntries(Object.entries(parsed).filter(([, value]) => !isEmpty(value)));
  return { text, data };
}
