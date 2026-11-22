// The two formatters that turn a value into a list and need nothing else from the parser: the
// array split, and the EPP status list built on it. They are apart from base.ts so the record
// code can read a status without loading the parser's date handling with it.
import { naturalSort } from '../common/utils';
import { isEmpty } from '../common/values';
import { isEppStatus } from '../record/epp';
import type { EppStatus } from '../record/epp';
import type { FieldFormatter, ParserOptions, WhoisQueryType, WhoisValue } from './data-types';
import { cleanArray, cleanStatus, whoisGetEppStatus } from './utils';

// enforce array fields
export const arrayFormatter: FieldFormatter<string[]> = (
  value: WhoisValue,
  field?: string,
  queryType?: WhoisQueryType,
  options?: ParserOptions
): string[] => {
  if (isEmpty(value)) return [];

  // if not an array, convert to array and clean
  const arrayValues = Array.isArray(value) ? cleanArray(value) : [String(value)];

  // split on newlines and commas
  const splitRegex = /[,\n]/;

  // process each element for potential splits and flatten the result
  const splitValues = arrayValues
    .filter(v => v !== null)
    .flatMap(v => {
      // remove bracketed and parenthesized content before splitting
      const cleaned = v.replace(/\[[^\]]*\]|\([^)]*\)/g, '');
      return cleaned.split(splitRegex).map(part => part.trim());
    });

  // remove empties, duplicates, and return values in original order
  const uniqueValues = cleanArray(splitValues);

  // natural sort the array
  return naturalSort(uniqueValues);
};

// handle status specific formatting after passing to arrayFormatter
// the field is named eppStatus, so it holds EPP codes and nothing else: values that don't
// map are dropped rather than passed through in whatever case the registry wrote them. the
// original text is never lost — eppStatusRaw keeps every value, mapped or not
export const statusFormatter: FieldFormatter<string[]> = (
  value: WhoisValue,
  field?: string,
  queryType?: WhoisQueryType,
  options?: ParserOptions
): string[] => {
  if (isEmpty(value)) return [];
  // first split into array and handle newlines/commas
  const splitArray = arrayFormatter(value);

  // then clean each status value, and keep only what maps to a canonical EPP code.
  // whoisGetEppStatus is already case-insensitive and already handles the spaced forms
  const validArray = splitArray
    .map(cleanStatus)
    .map(status => (status ? whoisGetEppStatus(status) : null))
    .filter((status): status is EppStatus => isEppStatus(status));

  // remove empties, duplicates, etc
  const cleanedArray = cleanArray(validArray);

  // natural sort the array
  return naturalSort(cleanedArray);
};
