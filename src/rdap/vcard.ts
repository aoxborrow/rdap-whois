import { RdapVcardSimple } from './types';

// Interface for vcard property structure
interface VcardPropertyInput {
  0?: string; // property name
  1?: { type?: string | string[] }; // parameters
  2?: string; // value type
  3?: unknown; // value
}

// Minimal type for a jCard/vCard property within the parser for clarity
type VcardProperty = [
  string, // Property name
  { [key: string]: unknown }, // Parameters object (pref, type, etc.)
  string, // Value type string (e.g., "text", "uri")
  unknown, // The actual value
];

// every property with a name, compared without case
function getPropertiesByName(allProps: VcardProperty[], name: string): VcardProperty[] {
  const lowerCaseName = name.toLowerCase();
  return allProps.filter(p => p[0].toLowerCase() === lowerCaseName);
}

// The property with the lowest 'pref' parameter, which is the most preferred. With no valid
// 'pref' on any of them, the first
function selectPreferred(items: VcardProperty[]): VcardProperty | undefined {
  if (!items || items.length === 0) {
    return undefined;
  }
  if (items.length === 1) {
    return items[0];
  }

  const itemsWithPref = items.filter(item => {
    const pref = item[1].pref;
    return (
      pref !== undefined &&
      (typeof pref === 'string' || typeof pref === 'number') &&
      !isNaN(parseInt(String(pref), 10))
    );
  });

  if (itemsWithPref.length === 0) {
    return items[0]; // No valid 'pref' found, return the first item
  }

  // Sort by 'pref' (lower is better)
  itemsWithPref.sort((a, b) => {
    const prefA = parseInt(String(a[1].pref), 10);
    const prefB = parseInt(String(b[1].pref), 10);
    return prefA - prefB;
  });

  return itemsWithPref[0];
}

/**
 * Read a jCard (RFC 7095), as an RDAP entity's vcardArray holds it, into its common fields.
 * Returns null when it has nothing but a version, and throws when it is not a jCard with a
 * version
 */
export function parseToVcardSimple(rawVcard: unknown): RdapVcardSimple | null {
  if (
    !Array.isArray(rawVcard) ||
    rawVcard.length !== 2 ||
    rawVcard[0] !== 'vcard' ||
    !Array.isArray(rawVcard[1])
  ) {
    throw new Error("Invalid vCard structure. Expected ['vcard', [propertiesArray]].");
  }

  const allProps = rawVcard[1] as VcardProperty[];
  const simple: Partial<RdapVcardSimple> = {};

  // Version (required)
  const versionProp = getPropertiesByName(allProps, 'version')[0];
  if (!versionProp || typeof versionProp[3] !== 'string' || !versionProp[3]) {
    throw new Error("RDAP vCard missing or invalid 'version' property.");
  }
  simple.version = versionProp[3];

  // Full Name (fn) and Organization (org)
  const fnProp = getPropertiesByName(allProps, 'fn')[0];
  const orgProp = selectPreferred(getPropertiesByName(allProps, 'org'));
  const kindProp = selectPreferred(getPropertiesByName(allProps, 'kind'));

  // Handle name and org fields
  if (fnProp && typeof fnProp[3] === 'string' && fnProp[3]) {
    simple.name = fnProp[3];
  }

  if (orgProp) {
    const orgValue = (orgProp as VcardPropertyInput)[3];
    let orgName: string | undefined;
    if (typeof orgValue === 'string') {
      orgName = orgValue;
    } else if (Array.isArray(orgValue) && orgValue.length > 0 && typeof orgValue[0] === 'string') {
      orgName = orgValue[0]; // First component is the primary org name
    }

    if (orgName) {
      if (!simple.name) {
        // Use org as name if no name is set
        simple.name = orgName;
        // Set kind to 'org' if not already set
        if (!kindProp || typeof kindProp[3] !== 'string') {
          simple.kind = 'org';
        }
      } else if (orgName !== simple.name) {
        // Only set org if it's different from name
        simple.org = orgName;
      }
    }
  }

  // Kind
  if (kindProp && typeof kindProp[3] === 'string') {
    simple.kind = kindProp[3];
  }

  // Organization Role (role)
  // NOTE: This is different from the entity role(!!), e.g. "Technical Contact"
  const roleProp = selectPreferred(getPropertiesByName(allProps, 'role'));
  if (roleProp && typeof roleProp[3] === 'string') {
    simple.orgRole = roleProp[3];
  }

  // Organization Title (title)
  const titleProp = selectPreferred(getPropertiesByName(allProps, 'title'));
  if (titleProp && typeof titleProp[3] === 'string') {
    simple.orgTitle = titleProp[3];
  }

  // Email
  const emailProp = selectPreferred(getPropertiesByName(allProps, 'email'));
  if (emailProp && typeof emailProp[3] === 'string') {
    simple.email = emailProp[3];
  }

  // Phone (tel)
  const allTelProps = getPropertiesByName(allProps, 'tel');
  let finalTelProp: VcardProperty | undefined = undefined;

  if (allTelProps.length > 0) {
    const voiceTels = allTelProps.filter(p => {
      const typeParam = (p as VcardPropertyInput)[1]?.type;
      const types = Array.isArray(typeParam)
        ? typeParam.map(String)
        : typeof typeParam === 'string'
          ? [typeParam]
          : [];
      return types.some(t => t.toLowerCase() === 'voice');
    });

    if (voiceTels.length > 0) {
      finalTelProp = selectPreferred(voiceTels);
      if (!finalTelProp) {
        finalTelProp = voiceTels[0];
      }
    }

    if (!finalTelProp) {
      finalTelProp = selectPreferred(allTelProps);
    }

    if (!finalTelProp && allTelProps.length > 0) {
      finalTelProp = allTelProps[0];
    }
  }

  if (finalTelProp && typeof finalTelProp[3] === 'string') {
    // Strip 'tel:' prefix and trim
    const phone = finalTelProp[3].replace(/^tel:/, '').trim();
    simple.phone = phone;
  }

  // Fax (tel with fax type)
  const faxTels = allTelProps.filter(p => {
    const typeParam = (p as VcardPropertyInput)[1]?.type;
    const types = Array.isArray(typeParam)
      ? typeParam.map(String)
      : typeof typeParam === 'string'
        ? [typeParam]
        : [];
    return types.some(t => t.toLowerCase() === 'fax');
  });

  let finalFaxProp: VcardProperty | undefined = undefined;
  if (faxTels.length > 0) {
    finalFaxProp = selectPreferred(faxTels);
    if (!finalFaxProp) {
      finalFaxProp = faxTels[0];
    }
  }

  if (finalFaxProp && typeof finalFaxProp[3] === 'string') {
    // Strip 'tel:' prefix and trim
    const fax = finalFaxProp[3].replace(/^tel:/, '').trim();
    simple.fax = fax;
  }

  // Address (adr) - parse structured address components
  const adrProp = selectPreferred(getPropertiesByName(allProps, 'adr'));
  if (adrProp && Array.isArray(adrProp[3])) {
    // ADR value is an array: [PO Box, Extended Address, Street, Locality, Region, Postal Code, Country]
    const adrValue = adrProp[3] as string[];
    if (Array.isArray(adrValue) && adrValue.length > 0) {
      // Pad array to ensure we have at least 7 components (servers may omit trailing empty ones)
      const paddedAdrValue = [...adrValue];
      while (paddedAdrValue.length < 7) {
        paddedAdrValue.push('');
      }

      const [poBox, extended, street, locality, region, postalCode, country] = paddedAdrValue.map(
        part => (typeof part === 'string' ? part.trim() : '')
      );

      // Combine PO Box, Extended, and Street into address array
      const addressParts = [poBox, extended, street].filter(part => part !== '');
      if (addressParts.length > 0) {
        // Split each address component on newlines and flatten the result
        simple.address = addressParts
          .flatMap(part => part.split('\n'))
          .map(part =>
            part
              .trim()
              .replace(/^,+|,+$/g, '')
              .trim()
          ) // Trim leading/trailing commas and spaces
          .filter(part => part !== '');
      }

      // Set individual address components
      if (locality) simple.city = locality;
      if (region) simple.state = region;
      if (postalCode) simple.postalCode = postalCode;

      // Country code can come from the value array or the cc parameter (RFC 8605)
      const countryFromValue = country;
      const countryFromParam = typeof adrProp[1].cc === 'string' ? adrProp[1].cc.trim() : '';

      // Use whichever country code is not empty, prioritizing the value array
      if (countryFromValue || countryFromParam) {
        simple.countryCode = countryFromValue || countryFromParam;
      }
    }
  }

  // Language (lang)
  const langProp = selectPreferred(getPropertiesByName(allProps, 'lang'));
  if (langProp && typeof langProp[3] === 'string') {
    simple.lang = langProp[3];
  }

  // Contact URI
  const contactUriProp = selectPreferred(getPropertiesByName(allProps, 'contact-uri'));
  if (
    contactUriProp &&
    typeof contactUriProp[3] === 'string' &&
    contactUriProp[3] !== simple.email
  ) {
    simple.contactUri = contactUriProp[3];
  }

  // URL
  const urlProp = selectPreferred(getPropertiesByName(allProps, 'url'));
  if (urlProp && typeof urlProp[3] === 'string') {
    simple.url = urlProp[3];
  }

  // Return null if only version field is present
  if (Object.keys(simple).length === 1 && simple.version) {
    return null;
  }

  return simple as RdapVcardSimple;
}
