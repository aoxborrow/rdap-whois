// .in (Afilias-operated era) — shares the Sponsoring-Registrar-id format; see ./afilias.ts.
import { sponsoringRegistrarId } from './afilias';
import type { FormatConfig } from '../formats';

export const config: FormatConfig = sponsoringRegistrarId;
