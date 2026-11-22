// .ve (nic.ve) — fred/whoisd base (handle-ref contact blocks); the contact's bare `address:`
// lines carry postal (`1012`) and state (`VE`) as their own rows, which the scoped `address`
// alias would swallow into the address array — the two ride the regexFields bridge.
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'fred',
  regexFields: {
    registrantPostalCode: 'address:\\s*(\\d+)\\s*$',
    registrantState: 'address:\\s*([A-Za-z]{2})\\n',
  },
};
