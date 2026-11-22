// .ee (EIS legacy host) — shares the EIS format; the config lives in ./eis-ee.ts.
import { eis } from './eis-ee';
import type { FormatConfig } from '../formats';

export const config: FormatConfig = eis;
