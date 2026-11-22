// .tg (nic.tg, JWhoisServer variant) — dot-fill on the VALUE side (`Domain:....nic.tg`).
// preprocess strips the fill once up front so EVERY field comes out clean, including the
// base-alias contact fields (registrant name/address/fax/email) the old per-field valueExtract
// missed — they were surfacing with their leading dots intact (`.........Google`).
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'generic-kv',
  preprocess: raw => raw.replace(/:\.+/g, ': '),
  aliases: {
    domainName: ['Domain'],
    eppStatus: ['Status'],
    registrarName: ['Registrar'],
    creationDate: ['Activation'],
    expirationDate: ['Expiration'],
    nameservers: ['Name Server (DB)'],
  },
  // the holder's `Tel:` rides the bridge — the same key repeats in every contact section, and
  // the first match (the holder's, `[PRIVEE]` when redacted) is the value.
  // runs on the TRUE (un-preprocessed) raw, so it still consumes the dot-fill in its own pattern.
  regexFields: { registrantPhone: 'Tel:\\.+(.*)' },
};
