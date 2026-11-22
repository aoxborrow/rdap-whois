// The `cocca` format: the CoCCA registry software
// (~19 ccTLDs: .tl/.gs/.ki/.ht/.ly/.cx/…). Its responses carry a `CoCCA` disclaimer, but
// STRUCTURALLY they are ICANN-shaped flat KV — the role is in the key (`Registrant
// Street:`), and multi-line street addresses fold across bare lines (icann's
// `foldContinuations`); the icann format parses them with nothing lost.
//
// So cocca is `icann` with a distinct name (for per-server assignment + the drift report)
// and CoCCA's own reserved/notfound phrasings layered on. No new parser capability — it is
// here to make the taxonomy honest, not to fix a loss.
import { icannFormat, ICANN_ALIASES } from './icann';
import type { WhoisFormat } from '../types';

export const coccaFormat: WhoisFormat = {
  ...icannFormat,
  name: 'cocca',
  aliases: ICANN_ALIASES,
  meta: {
    ...icannFormat.meta,
    notfound: [...(icannFormat.meta?.notfound ?? []), '^\\s*No Object Found\\.?\\s*$'],
    // CoCCA's Spec-5 answer for withheld names, observed in the corpus (.tl/.ki family)
    reserved: [
      ...(icannFormat.meta?.reserved ?? []),
      '^\\s*Prohibited String - Domain Cannot Be Registered',
    ],
  },
};
