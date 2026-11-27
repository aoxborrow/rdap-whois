// The registrar lane's report: what check-registrars.ts measured on its last run
// (registry-health/registrar-report.json), and the section of report.md that summarizes it
import { existsSync, readFileSync } from 'node:fs';
import { HEALTH_DIR } from '../lib/paths';
import type { ProbeClassification } from '../registry-health/state';
import type { Coverage } from './registrars';

export const REGISTRAR_REPORT_FILE = `${HEALTH_DIR}registrar-report.json`;

export type RegistrarReport = {
  probedAt: string;
  coverage: Coverage;
  // registrars whose server last probed healthy
  healthy: { whois: number; rdap: number; either: number };
  // distinct servers by classification
  servers: {
    whois: Partial<Record<ProbeClassification, number>>;
    rdap: Partial<Record<ProbeClassification, number>>;
  };
  parse: {
    minScore: number;
    // WHOIS servers that answered with a record, and those that parsed
    answered: number;
    parsed: number;
    registrarsAnswered: number;
    registrarsParsed: number;
    unparsed: Array<{ host: string; registrars: number; score: number }>;
    // answered healthy with none of the record's fields: a notice, not a record
    noRecord: Array<{ host: string; registrars: number; firstLine: string }>;
  };
  elapsedSeconds: number;
};

const classes = (counts: Partial<Record<ProbeClassification, number>>): string =>
  Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .map(([classification, count]) => `${count} ${classification}`)
    .join(', ') || 'none probed';

export function renderRegistrarSection(): string {
  if (!existsSync(REGISTRAR_REPORT_FILE)) return '';
  const {
    coverage: c,
    healthy,
    servers,
    parse,
    elapsedSeconds,
  } = JSON.parse(readFileSync(REGISTRAR_REPORT_FILE, 'utf8')) as RegistrarReport;
  const lines = [
    '',
    '## Registrars',
    '',
    `${c.accredited} accredited registrars (registry-health/registrars.json): ${c.rdap} with an RDAP base, ${c.whois} with a known WHOIS server, ${c.both} both, ${c.neither} neither.`,
    '',
    `- Healthy: ${healthy.rdap} by RDAP, ${healthy.whois} by WHOIS, ${healthy.either} by either`,
    `- RDAP bases (${c.rdapBases}): ${classes(servers.rdap)}`,
    `- WHOIS servers (${c.whoisServers}): ${classes(servers.whois)}`,
    `- Parsed: ${parse.parsed} of the ${parse.answered} WHOIS servers that answered with a record (${parse.registrarsParsed} of ${parse.registrarsAnswered} registrars) gave at least ${parse.minScore} of the record's core fields`,
    `- Probed in ${elapsedSeconds}s`,
    '',
  ];
  if (parse.unparsed.length) {
    lines.push('Answered but did not parse, by registrars served:', '');
    for (const u of parse.unparsed.slice(0, 20)) {
      lines.push(
        `- ${u.host} (${u.registrars} registrar${u.registrars === 1 ? '' : 's'}, score ${u.score})`
      );
    }
    if (parse.unparsed.length > 20) {
      lines.push(`- …and ${parse.unparsed.length - 20} more (see registrar-report.json)`);
    }
    lines.push('');
  }
  if (parse.noRecord.length) {
    lines.push(
      `Answered with a notice instead of a record (${parse.noRecord.length}), worth a notfound, throttle or refusal pattern:`,
      ''
    );
    for (const n of parse.noRecord.slice(0, 20)) lines.push(`- ${n.host}: \`${n.firstLine}\``);
    lines.push('');
  }
  return lines.join('\n');
}
