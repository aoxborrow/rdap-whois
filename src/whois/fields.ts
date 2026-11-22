// Field names for a contact role are the role plus the attribute, in camelCase:
// registrant + postalCode → registrantPostalCode.
export function scopedField(scope: string, suffix: string): string {
  return scope + suffix.charAt(0).toUpperCase() + suffix.slice(1);
}
