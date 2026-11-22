// .uy (nic.org.uy) — labeled-blocks; Spanish `Nombre de Dominio` + NS section.
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'labeled-blocks',
  blankLinesInBlocks: true,
  sectionHeaders: ['Servidor(es) de Nombres de Dominio'],
  blockFields: { 'servidor(es) de nombres de dominio': 'nameservers' },
  aliases: { domainName: ['Nombre de Dominio'], updatedDate: ['Ultima Actualizacion'] },
  valueExtract: { nameservers: ['^- *', ''] }, // NS lines are `- ns1.markmonitor.com`
};
