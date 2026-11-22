// Hand-maintained static lists. TOP_100_TLDS gates the `whois:check-parsers --strict`
// regression oracle. The coverage figures below were counted by a one-off script that is
// gone; count the fixtures per TLD again to refresh them

// === Top 100 Coverage ===

// Top 100 TLD Coverage:
// Total Top TLDs: 100
// Top TLDs with fixtures: 89
// Coverage: 89.00%

// Top TLDs without fixtures:
// (#9) shop
// (#29) xn--p1ai
// (#36) es
// (#46) dev
// (#47) sk
// (#69) gr
// (#72) link
// (#82) vn
// (#89) xn--ses554g
// (#96) il
// (#98) su

// Top 100 Registrar Coverage:
// Total Top Registrar Servers: 98
// Top Registrar Servers with fixtures: 62
// Coverage: 63.27%

// Top Registrar Servers without fixtures:
// (#8) whois.namebright.com
// (#13) whois.wix.com
// (#17) whois.aliyun.com
// (#24) whois.fastdomain.com
// (#26) whois.porkbun.com
// (#28) whois.cscglobal.com
// (#38) whois.xinnet.com
// (#41) whois.nameking.com
// (#43) whois.123-reg.co.uk
// (#46) whois.register.it
// (#51) whois.annulet.com
// (#52) whois.launchpad.com
// (#56) whois.nicproxy.com
// (#57) whois.one.com
// (#59) whois.syra.com.au
// (#64) whois.internet.bs
// (#66) whois.cosmotown.com
// (#68) whois.nordreg.se
// (#71) whois.isimtescil.net
// (#73) whois.diymysite.com
// (#74) whois.juming.com
// (#76) whois.rolr.eu
// (#77) whois.onlinenic.com
// (#80) whois.metunic.com.tr
// (#83) whois.antagus.de
// (#86) whois.melbourneit.com
// (#87) whois.domainpeople.com
// (#88) whois.bizcn.com
// (#89) whois.atakteknoloji.com
// (#90) whois.infomaniak.com
// (#91) whois.hosting.kr
// (#92) whois.bigrock.in
// (#93) whois.bookmyname.com
// (#95) whois.ihs.com.tr
// (#96) whois.eranet.com
// (#97) whois.fabulous.com

// top 100 registrars
export const TOP_100_REGISTRARS = {
  'GoDaddy': 'whois.godaddy.com',
  'NameCheap': 'whois.namecheap.com',
  'Tucows': 'whois.tucows.com',
  'GoogleInc': 'whois.nic.google',
  'Network Solutions': 'whois.networksolutions.com',
  '1 & 1 INTERNET': 'whois.1und1.info',
  'BeijingLanhaiJiyeTechnology': 'whois.gname.com',
  'NameBright': 'whois.namebright.com',
  'GMO Internet': 'whois.discount-domain.com',
  'Dynadot': 'whois.dynadot.com',
  'PublicDomainRegistry': 'whois.publicdomainregistry.com',
  'eNom': 'whois.enom.com',
  'Wix': 'whois.wix.com',
  'NameSilo': 'whois.namesilo.com',
  'SquarespaceDomains': 'whois.squarespace.domains',
  'Hostinger': 'whois.hostinger.com',
  'Alibaba': 'whois.aliyun.com',
  'Wild West Domains': 'whois.wildwestdomains.com',
  'HiChina': 'grs-whois.hichina.com',
  'OVH': 'whois.ovh.com',
  'CloudFlare': 'whois.cloudflare.com',
  'Name.com': 'whois.name.com',
  'Key-Systems': 'whois.rrpproxy.net',
  'Fast Domain': 'whois.fastdomain.com',
  'AmazonRegistrar': 'whois.registrar.amazon.com',
  'Porkbun': 'whois.porkbun.com',
  'Domain.com': 'whois.domain.com',
  'CSC Corporate Domains': 'whois.cscglobal.com',
  'Register.com': 'whois.register.com',
  'CrononAG': 'whois.cronon.net',
  'Spaceship': 'whois.spaceship.com',
  'HostingConceptsBV': 'whois.registrar.eu',
  'Automattic': 'whois.sawbuck.com',
  'PSI-USA': 'whois.psi-usa.info',
  'MarkMonitor': 'whois.markmonitor.com',
  'GANDI': 'whois.gandi.net',
  'RealTime Register': 'whois.yoursrs.com',
  'XinNet': 'whois.xinnet.com',
  '1 API': 'whois.1api.net',
  'Ascio Technologies': 'whois.ascio.com',
  'NameKing': 'whois.nameking.com',
  'New Dream Network': 'whois.dreamhost.com',
  'Webfusion': 'whois.123-reg.co.uk',
  'DNSPod': 'whois.dnspod.com',
  'Mesh Digital': 'whois.meshdigital.com',
  'REGISTER.IT': 'whois.register.it',
  'Chengdu': 'whois.west.cn',
  'Netowl': 'whois.star-domain.jp',
  'InterNetWire Communications': 'whois.registrygate.com',
  'Web Commerce Comm.': 'whois.webnic.cc',
  'Annulet': 'whois.annulet.com',
  'Launchpad': 'whois.launchpad.com',
  'Gabia': 'whois.gabia.com',
  'CSL Computer Service': 'whois.joker.com',
  'United-Domains': 'whois.udag.net',
  'Nics Telekomunikasyon Ticaret': 'whois.nicproxy.com',
  'One.com': 'whois.one.com',
  'Arsys Internet': 'whois.nicline.com',
  'Aust Domains': 'whois.syra.com.au',
  'Japan Registry Services': 'whois.jprs.jp',
  'eName': 'whois.ename.com',
  'Metaregistrar': 'whois.metaregistrar.com',
  'Reg.ru': 'whois.reg.ru',
  'InternetDomainServiceBS': 'whois.internet.bs',
  'DNC Holdings': 'whois.directnic.com',
  'Cosmotown': 'whois.cosmotown.com',
  'Uniregistrar Corp': 'whois.uniregistrar.com',
  'Nordreg': 'whois.nordreg.se',
  'Moniker': 'whois.moniker.com',
  'GoDaddy Corporate Domains': 'whois.dnrs.godaddy',
  'İsimtescil': 'whois.isimtescil.net',
  'Epik': 'whois.epik.com',
  'CloudYuquLLC': 'whois.diymysite.com',
  'HefeiJuming': 'whois.juming.com',
  'OwnReg': 'whois.ownregistrar.com',
  'StichtingRegistrarofLastResortFoundation': 'whois.rolr.eu',
  'OnlineNIC': 'whois.onlinenic.com',
  'Xiamen35': 'whois.35.com',
  'Soluciones Corporativas': 'whois.scip.es',
  'metunic': 'whois.metunic.com.tr',
  'RU-CENTER': 'whois.nic.ru',
  'Subreg': 'whois.regtons.com',
  '1st Antagus': 'whois.antagus.de',
  'COM LAUDE': 'whois.comlaude.com',
  'Dinahosting': 'whois.dinahosting.com',
  'Melbourne IT': 'whois.melbourneit.com',
  'DomainPeople': 'whois.domainpeople.com',
  'Bizcn': 'whois.bizcn.com',
  'Atak Teknoloji': 'whois.atakteknoloji.com',
  'Infomaniak': 'whois.infomaniak.com',
  'Megazone': 'whois.hosting.kr',
  'BigRock Solutions': 'whois.bigrock.in',
  'Online SAS': 'whois.bookmyname.com',
  'VentraIP Wholesale': 'whois.synergywholesale.com',
  'IHS Telekom': 'whois.ihs.com.tr',
  'Eranet International': 'whois.eranet.com',
  'Fabulous': 'whois.fabulous.com',
  'InterNetworX': 'whois.domrobot.com',
};

export const TOP_100_TLDS = [
  'com',
  'net',
  'org',
  'uk',
  'de',
  'ru',
  'xyz',
  'info',
  'shop',
  'top',
  'online',
  'ch',
  'store',
  'nl',
  'it',
  'fr',
  'site',
  'cn',
  'se',
  'vip',
  'biz',
  'pl',
  'eu',
  'br',
  'jp',
  'au',
  'pro',
  'app',
  'xn--p1ai',
  'ca',
  'sbs',
  'be',
  'club',
  'lol',
  'cz',
  'es',
  'today',
  'live',
  'in',
  'bond',
  'click',
  'dk',
  'fun',
  'at',
  'tech',
  'dev',
  'sk',
  'icu',
  'co',
  'life',
  'cloud',
  'asia',
  'space',
  'blog',
  'world',
  'hu',
  'buzz',
  'ir',
  'cfd',
  'io',
  'za',
  'kr',
  'art',
  'work',
  'one',
  'ro',
  'website',
  'mobi',
  'gr',
  'fi',
  'no',
  'link',
  'ua',
  'tr',
  'nu',
  'nz',
  'cyou',
  'ar',
  'group',
  'us',
  'mx',
  'vn',
  'tokyo',
  'id',
  'cl',
  'me',
  'digital',
  'cc',
  'xn--ses554g',
  'pt',
  'tw',
  'lat',
  'studio',
  'agency',
  'ltd',
  'il',
  'email',
  'su',
  'ie',
  'design',
];
