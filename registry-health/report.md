# Registry health report (whois lane)

Probed 1270 whois servers; 213 dead-candidate, 245 refused (an error page instead of a record).

## 🟠 Moat outages (41, 17 ccTLD, none new)

Dead whois with NO RDAP fallback (down ≥14d) — these TLDs are unlookupable. Never auto-nulled. Only an outage the last committed report did not list turns the build red.

- **ac.za** → whois.ac.za (dead 136d, ×11) — Could not connect to whois.ac.za:43: host unreachable
- **af** → whois.nic.af (dead 17d, ×4) — Timed out waiting for the proxy to connect to whois.nic.af:43
- **alt.za** → whois.alt.za (dead 136d, ×11) — Could not connect to whois.alt.za:43: host unreachable
- **bentley** → whois.nic.bentley (dead 136d, ×11) — Could not connect to whois.nic.bentley:43: host unreachable
- **cf** → whois.dot.cf (dead 136d, ×11) — Could not connect to whois.dot.cf:43: host unreachable
- **dunlop** → whois.nic.dunlop (dead 136d, ×11) — Could not connect to whois.nic.dunlop:43: host unreachable
- **edu.cn** → whois.edu.cn (dead 136d, ×11) — Could not connect to whois.edu.cn:43: host unreachable
- **edu.ru** → whois.informika.ru (dead 136d, ×11) — Timed out waiting for the proxy to connect to whois.informika.ru:43
- **es** → whois.nic.es (dead 122d, ×7) — Timed out waiting for the proxy to connect to whois.nic.es:43
- **eu.org** → whois.eu.org (dead 136d, ×11) — Timed out waiting for the proxy to connect to whois.eu.org:43
- **goo** → whois.nic.gmo (dead 87d, ×5) — Timed out waiting for the proxy to connect to whois.nic.gmo:43
- **gov.za** → whois.gov.za (dead 87d, ×5) — Timed out waiting for the proxy to connect to whois.gov.za:43
- **gp** → whois.nic.gp (dead 136d, ×11) — Timed out waiting for the proxy to connect to whois.nic.gp:43
- **helsinki** → whois.nic.helsinki (dead 87d, ×5) — Could not connect to whois.nic.helsinki:43: host unreachable
- **hm** → whois.registry.hm (dead 136d, ×11) — Could not connect to whois.registry.hm:43: host unreachable
- **iq** → whois.cmc.iq (dead 136d, ×11) — Could not connect to whois.cmc.iq:43: host unreachable
- **juniper** → whois.nic.juniper (dead 87d, ×5) — Could not connect to whois.nic.juniper:43: host unreachable
- **ki** → whois.nic.ki (dead 17d, ×4) — Timed out waiting for the proxy to connect to whois.nic.ki:43
- **lancaster** → whois.nic.lancaster (dead 136d, ×11) — Could not connect to whois.nic.lancaster:43: host unreachable
- **lk** → whois.nic.lk (dead 136d, ×11) — Timed out waiting for the proxy to connect to whois.nic.lk:43
- **ma** → whois.registre.ma (dead 17d, ×4) — Timed out waiting for the proxy to connect to whois.registre.ma:43
- **mt** → whois.nic.org.mt (dead 136d, ×11) — Timed out waiting for the proxy to connect to whois.nic.org.mt:43
- **pf** → whois.registry.pf (dead 136d, ×11) — Timed out waiting for the proxy to connect to whois.registry.pf:43
- **ps** → whois.pnina.ps (dead 136d, ×11) — Could not connect to whois.pnina.ps:43: host unreachable
- **redstone** → whois.nic.redstone (dead 136d, ×11) — Could not connect to whois.nic.redstone:43: host unreachable
- **sb** → whois.nic.net.sb (dead 17d, ×4) — Timed out waiting for the proxy to connect to whois.nic.net.sb:43
- **sy** → whois.tld.sy (dead 87d, ×5) — Could not connect to whois.tld.sy:43: host unreachable
- **tk** → whois.dot.tk (dead 136d, ×11) — Timed out waiting for the proxy to connect to whois.dot.tk:43
- **tl** → whois.nic.tl (dead 17d, ×4) — Timed out waiting for the proxy to connect to whois.nic.tl:43
- **uk.co** → whois.uk.co (dead 136d, ×11) — Could not connect to whois.uk.co:43: host unreachable
- **uy** → whois.nic.org.uy (dead 136d, ×11) — Timed out waiting for the proxy to connect to whois.nic.org.uy:43
- **wolterskluwer** → whois.nic.wolterskluwer (dead 136d, ×11) — Could not connect to whois.nic.wolterskluwer:43: host unreachable
- **xn--fzc2c9e2c** → whois.nic.lk (dead 136d, ×11) — Timed out waiting for the proxy to connect to whois.nic.lk:43
- **xn--l1acc** → whois.mn (dead 136d, ×11) — Timed out waiting for the proxy to connect to whois.mn:43
- **xn--mgbtx2b** → whois.cmc.iq (dead 136d, ×11) — Could not connect to whois.cmc.iq:43: host unreachable
- **xn--ogbpf8fl** → whois.tld.sy (dead 87d, ×5) — Could not connect to whois.tld.sy:43: host unreachable
- **xn--wgbh1c** → whois.dotmasr.eg (dead 136d, ×11) — Could not connect to whois.dotmasr.eg:43: host unreachable
- **xn--xkc2al3hye2a** → whois.nic.lk (dead 136d, ×11) — Timed out waiting for the proxy to connect to whois.nic.lk:43
- **xn--ygbi2ammx** → whois.pnina.ps (dead 136d, ×11) — Could not connect to whois.pnina.ps:43: host unreachable
- **za.net** → whois.za.net (dead 136d, ×11) — Could not connect to whois.za.net:43: host unreachable
- **za.org** → whois.za.org (dead 136d, ×11) — Could not connect to whois.za.org:43: host unreachable

## 🟡 Moat watch (5, 5 ccTLD)

Dead whois with NO RDAP, down <14d — red if they persist. Never nulled.

- jo → whois.nic.net.jo (dead 1d, ×2) — Timed out waiting for the proxy to connect to whois.nic.net.jo:43
- nc → whois.nc (dead 1d, ×1) — Timed out waiting for the proxy to connect to whois.nc:43
- pt → whois.dns.pt (dead 10d, ×3) — Timed out waiting for the proxy to connect to whois.dns.pt:43
- so → whois.nic.so (dead 10d, ×3) — Timed out waiting for the proxy to connect to whois.nic.so:43
- ws → whois.website.ws (dead 1d, ×1) — Timed out waiting for the proxy to connect to whois.website.ws:43

## Phase-outs applied (1)

Routed to null (dead ≥45d + ≥4 failed probes + IANA dropped the line + working RDAP):

- **fj** → ~~www.whois.fj~~ null (dead 119d, ×6)

## Phase-out candidates (336)

Dead/failing but not yet phased out:

- abudhabi → whois.nic.abudhabi (dead 1d, ×1) — dead only 1d (<45d); only 1 failed probe(s) (<4); IANA still lists a whois server
- academy → whois.nic.academy (dead 17d, ×4) — dead only 17d (<45d)
- accountants → whois.nic.accountants (dead 17d, ×4) — dead only 17d (<45d)
- actor → whois.nic.actor (dead 17d, ×4) — dead only 17d (<45d)
- agency → whois.nic.agency (dead 17d, ×4) — dead only 17d (<45d)
- airforce → whois.nic.airforce (dead 17d, ×4) — dead only 17d (<45d)
- apartments → whois.nic.apartments (dead 17d, ×4) — dead only 17d (<45d)
- archi → whois.nic.archi (dead 17d, ×4) — dead only 17d (<45d)
- army → whois.nic.army (dead 17d, ×4) — dead only 17d (<45d)
- as → whois.nic.as (dead 87d, ×5) — IANA still lists a whois server
- associates → whois.nic.associates (dead 17d, ×4) — dead only 17d (<45d)
- attorney → whois.nic.attorney (dead 17d, ×4) — dead only 17d (<45d)
- auction → whois.nic.auction (dead 17d, ×4) — dead only 17d (<45d)
- band → whois.nic.band (dead 17d, ×4) — dead only 17d (<45d)
- bargains → whois.nic.bargains (dead 17d, ×4) — dead only 17d (<45d)
- bbc → whois.nic.bbc (dead 136d, ×11) — IANA still lists a whois server
- bet → whois.nic.bet (dead 17d, ×4) — dead only 17d (<45d)
- bike → whois.nic.bike (dead 17d, ×4) — dead only 17d (<45d)
- bingo → whois.nic.bingo (dead 17d, ×4) — dead only 17d (<45d)
- bio → whois.nic.bio (dead 17d, ×4) — dead only 17d (<45d)
- black → whois.nic.black (dead 17d, ×4) — dead only 17d (<45d)
- blue → whois.nic.blue (dead 17d, ×4) — dead only 17d (<45d)
- boutique → whois.nic.boutique (dead 17d, ×4) — dead only 17d (<45d)
- bridgestone → whois.nic.bridgestone (dead 87d, ×5) — RDAP listed but unhealthy
- broker → whois.nic.broker (dead 17d, ×4) — dead only 17d (<45d)
- brother → whois.nic.brother (dead 87d, ×5) — RDAP listed but unhealthy
- builders → whois.nic.builders (dead 17d, ×4) — dead only 17d (<45d)
- business → whois.nic.business (dead 17d, ×4) — dead only 17d (<45d)
- cab → whois.nic.cab (dead 17d, ×4) — dead only 17d (<45d)
- cafe → whois.nic.cafe (dead 17d, ×4) — dead only 17d (<45d)
- camera → whois.nic.camera (dead 17d, ×4) — dead only 17d (<45d)
- camp → whois.nic.camp (dead 17d, ×4) — dead only 17d (<45d)
- canon → whois.nic.canon (dead 87d, ×5) — RDAP listed but unhealthy
- capital → whois.nic.capital (dead 17d, ×4) — dead only 17d (<45d)
- cards → whois.nic.cards (dead 17d, ×4) — dead only 17d (<45d)
- care → whois.nic.care (dead 17d, ×4) — dead only 17d (<45d)
- careers → whois.nic.careers (dead 17d, ×4) — dead only 17d (<45d)
- cash → whois.nic.cash (dead 17d, ×4) — dead only 17d (<45d)
- casino → whois.nic.casino (dead 17d, ×4) — dead only 17d (<45d)
- catering → whois.nic.catering (dead 17d, ×4) — dead only 17d (<45d)
- center → whois.nic.center (dead 17d, ×4) — dead only 17d (<45d)
- chat → whois.nic.chat (dead 17d, ×4) — dead only 17d (<45d)
- cheap → whois.nic.cheap (dead 17d, ×4) — dead only 17d (<45d)
- church → whois.nic.church (dead 17d, ×4) — dead only 17d (<45d)
- circle → whois.nic.circle (dead 17d, ×4) — dead only 17d (<45d)
- city → whois.nic.city (dead 17d, ×4) — dead only 17d (<45d)
- claims → whois.nic.claims (dead 17d, ×4) — dead only 17d (<45d)
- cleaning → whois.nic.cleaning (dead 17d, ×4) — dead only 17d (<45d)
- clinic → whois.nic.clinic (dead 17d, ×4) — dead only 17d (<45d)
- clothing → whois.nic.clothing (dead 17d, ×4) — dead only 17d (<45d)
- coach → whois.nic.coach (dead 17d, ×4) — dead only 17d (<45d)
- codes → whois.nic.codes (dead 17d, ×4) — dead only 17d (<45d)
- coffee → whois.nic.coffee (dead 17d, ×4) — dead only 17d (<45d)
- community → whois.nic.community (dead 17d, ×4) — dead only 17d (<45d)
- company → whois.nic.company (dead 17d, ×4) — dead only 17d (<45d)
- computer → whois.nic.computer (dead 17d, ×4) — dead only 17d (<45d)
- condos → whois.nic.condos (dead 17d, ×4) — dead only 17d (<45d)
- construction → whois.nic.construction (dead 17d, ×4) — dead only 17d (<45d)
- consulting → whois.nic.consulting (dead 17d, ×4) — dead only 17d (<45d)
- contact → whois.nic.contact (dead 17d, ×4) — dead only 17d (<45d)
- …and 276 more (see decisions.json)

## Unhealthy routes (248)

Routes pointing at servers that answered oddly (suspect/error) or with an error page instead of a record (refused) — worth a look:

- academy → whois.nic.academy [refused] — error page: TLD is not supported.
- accountants → whois.nic.accountants [refused] — error page: TLD is not supported.
- actor → whois.nic.actor [refused] — error page: TLD is not supported.
- agency → whois.nic.agency [refused] — error page: TLD is not supported.
- airforce → whois.nic.airforce [refused] — error page: TLD is not supported.
- apartments → whois.nic.apartments [refused] — error page: TLD is not supported.
- army → whois.nic.army [refused] — error page: TLD is not supported.
- associates → whois.nic.associates [refused] — error page: TLD is not supported.
- attorney → whois.nic.attorney [refused] — error page: TLD is not supported.
- auction → whois.nic.auction [refused] — error page: TLD is not supported.
- band → whois.nic.band [refused] — error page: TLD is not supported.
- bargains → whois.nic.bargains [refused] — error page: TLD is not supported.
- bike → whois.nic.bike [refused] — error page: TLD is not supported.
- bingo → whois.nic.bingo [refused] — error page: TLD is not supported.
- boutique → whois.nic.boutique [refused] — error page: TLD is not supported.
- broker → whois.nic.broker [refused] — error page: TLD is not supported.
- builders → whois.nic.builders [refused] — error page: TLD is not supported.
- business → whois.nic.business [refused] — error page: TLD is not supported.
- cab → whois.nic.cab [refused] — error page: TLD is not supported.
- cafe → whois.nic.cafe [refused] — error page: TLD is not supported.
- camera → whois.nic.camera [refused] — error page: TLD is not supported.
- camp → whois.nic.camp [refused] — error page: TLD is not supported.
- capital → whois.nic.capital [refused] — error page: TLD is not supported.
- cards → whois.nic.cards [refused] — error page: TLD is not supported.
- care → whois.nic.care [refused] — error page: TLD is not supported.
- careers → whois.nic.careers [refused] — error page: TLD is not supported.
- cash → whois.nic.cash [refused] — error page: TLD is not supported.
- casino → whois.nic.casino [refused] — error page: TLD is not supported.
- catering → whois.nic.catering [refused] — error page: TLD is not supported.
- center → whois.nic.center [refused] — error page: TLD is not supported.

## Throttling seen (12)

Servers that throttled a probe, the runs they did it in, and the limit the library applied (`published` = from data/limits.json):

- whois.nic.ch (whois) ×3, last 2026-11-27 — 1 in flight, 1000 ms apart, published
- whois.nic.li (whois) ×3, last 2026-11-27 — 1 in flight, 1000 ms apart, published
- whois.meshdigital.com (whois) ×2, last 2026-11-27 — 2 in flight, 250 ms apart
- rdap.gmoregistry.net (rdap) ×2, last 2026-11-27 — 2 in flight, 250 ms apart
- easydns.rdap.tucows.com (rdap) ×1, last 2026-11-27 — 2 in flight, 250 ms apart
- rdap.gocanadadomains.com (rdap) ×2, last 2026-11-27 — 2 in flight, 250 ms apart
- rdap.gomontenegrodomains.com (rdap) ×1, last 2026-11-27 — 2 in flight, 250 ms apart
- whois.bluerazor.com (whois) ×1, last 2026-11-27 — 2 in flight, 250 ms apart
- whois.wildwestdomains.com (whois) ×1, last 2026-11-27 — 2 in flight, 250 ms apart
- rdap.123-reg.co.uk (rdap) ×1, last 2026-11-27 — 2 in flight, 250 ms apart
- rdap.gofrancedomains.com (rdap) ×1, last 2026-11-27 — 2 in flight, 250 ms apart
- whois.goaustraliadomains.com (whois) ×1, last 2026-11-27 — 2 in flight, 250 ms apart

## Parser regression

1400 fixtures, 100.0% parse clean; 0 top-100 regression(s).

## Oracle cross-check

- corpus: 2884 response(s) vs whoiser+likexian+weppos — 241 we-missing, 306 value-mismatch, 838 we-extra (424 groups)
- live sample: 13 response(s) vs whoiser+likexian+weppos+rdap — 8 we-missing, 0 value-mismatch, 1 we-extra (9 groups)

New divergence groups since last review (5):
- whois.aitdomains.com|expiration_date|we-extra
- whois.french-connexion.com|creation_date|value-mismatch
- whois.french-connexion.com|dnssec|we-extra
- whois.french-connexion.com|expiration_date|value-mismatch
- whois.french-connexion.com|updated_date|value-mismatch

## Community server-list diff

- debian/whois: 1421 TLDs — 133 missing-tld, 68 server-disagrees, 28 we-only
- weppos/whois: 1320 TLDs — 205 missing-tld, 218 server-disagrees, 201 we-only

Probe-verified additions to the discovered layer (2):
- **za** → whois.nic.za
- **doosan** → whois.nic.xn--cg4bki

New divergences since last review (4):
- debian/whois|missing-tld|ggee
- debian/whois|missing-tld|pioneer
- weppos/whois|missing-tld|ggee
- weppos/whois|missing-tld|pioneer

## Registrars

3323 accredited registrars (registry-health/registrars.json): 3320 with an RDAP base, 2383 with a known WHOIS server, 2383 both, 3 neither.

- Healthy: 3235 by RDAP, 2274 by WHOIS, 3247 by either
- RDAP bases (475): 391 healthy, 53 suspect, 31 dead-candidate
- WHOIS servers (280): 178 healthy, 77 dead-candidate, 16 notfound-fp, 5 suspect, 3 refused, 1 throttled
- Parsed: 172 of the 172 WHOIS servers that answered with a record (2268 of 2268 registrars) gave at least 7 of the record's core fields
- Probed in 210s

Answered with a notice instead of a record (6), worth a notfound, throttle or refusal pattern:

- grs-whois.aliyun.com: `Allow only queries : com,net,cc,tv`
- rdap.routing.net: `Query Limit reached`
- whois.global-village.de: `For thick registries use the web whois http://whois.global-village.de`
- whois.infomaniak.com: `There is no match for this domain name.`
- whois.register.eu: `RESTRICTED - ICANN prohohibited domain name.`
- whois.xtom.com: `NOTICE: In accordance with ICANN compliance policies, our whois server has been discontinued. Please use the RDAP protoc`

