// .kr (KRNIC) — the response repeats itself in Korean then ENGLISH; alias the clean English
// keys. registrarUrl is embedded in `Authorized Agency: Whois Corp.(http://…)` (kept in the
// name, as the server wrote it; the url is pulled out by valueExtract). `DNSSEC:` appears in BOTH
// sections, and generic-kv takes the FIRST — the Korean `미서명` — so a regexField anchored to
// `# ENGLISH` pulls the English `unsigned`/`signed`.
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'generic-kv',
  aliases: {
    creationDate: ['Registered Date'],
    updatedDate: ['Last Updated Date'],
    registrarName: ['Authorized Agency'],
    registrarUrl: ['Authorized Agency'],
    nameservers: ['Host Name', '호스트이름'],
    adminName: ['Administrative Contact(AC)'],
    adminEmail: ['AC E-Mail'],
    adminPhone: ['AC Phone Number'],
  },
  // pull the url out of `Whois Corp.(http://whois.co.kr)` for registrarUrl (name keeps parens)
  valueExtract: { registrarUrl: ['.*\\((https?://[^)]+)\\).*', '$1'] },
  // dnssec from the ENGLISH section, not the Korean `미서명` that appears first
  regexFields: { dnssec: '# ENGLISH[\\s\\S]*?DNSSEC\\s+:\\s+(\\S+)' },
};
