// .бг (imena.bg) — the same output as Register.BG's for .bg. Its names are internationalised,
// and the name line carries both spellings: `DOMAIN NAME: казино-игри.бг (xn--…)`. The name
// is the first, and the nameservers are bare lines under `NAME SERVER INFORMATION:`
import type { FormatConfig } from '../formats';
import { config as registerBg } from './whois.register.bg';

export const config: FormatConfig = registerBg;
