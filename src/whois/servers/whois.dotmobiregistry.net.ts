// .mobi (Afilias) — shares the Sponsoring-Registrar-id format; the config lives in ./afilias.ts.
import { sponsoringRegistrarId } from './afilias';
import type { FormatConfig } from '../formats';

export const config: FormatConfig = sponsoringRegistrarId;
