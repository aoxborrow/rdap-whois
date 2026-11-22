// .je (CIDR) — shares the CIDR registry format; the config lives in ./cidr.ts.
import { cidr } from './cidr';
import type { FormatConfig } from '../formats';

export const config: FormatConfig = cidr;
