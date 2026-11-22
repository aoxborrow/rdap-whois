// .tr (TRABIS) — shares the TRABIS format; the config lives in ./nic-tr.ts.
import { nicTr } from './nic-tr';
import type { FormatConfig } from '../formats';

export const config: FormatConfig = nicTr;
