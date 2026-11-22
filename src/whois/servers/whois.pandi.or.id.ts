// .id (PANDI alternate host) — shares the PANDI format; the config lives in ./pandi.ts.
import { pandi } from './pandi';
import type { FormatConfig } from '../formats';

export const config: FormatConfig = pandi;
