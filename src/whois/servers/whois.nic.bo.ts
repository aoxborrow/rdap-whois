// .bo (NIC Bolivia) — Spanish COLON-LESS section headers (`TITULAR DEL DOMINIO`,
// `CONTACTO ADMINISTRATIVO/TECNICO/FINANCIERO`) + localized subfield keys. Pure config on
// the block-scoped base: headers + role map + Spanish scope spellings + two dates.
// Since 2026 the server writes a shorter form beside it: `Dominio:`, the headers with a
// colon (`TITULAR:`), unaccented keys (`Pais`, `Direccion`) and `Fecha de registro`.
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'block-scoped',
  sectionHeaders: [
    'TITULAR DEL DOMINIO',
    'CONTACTO ADMINISTRATIVO',
    'CONTACTO TECNICO',
    'CONTACTO FINANCIERO',
    'TITULAR',
  ],
  blockScopes: {
    'titular del dominio': 'registrant',
    'titular': 'registrant',
    'contacto administrativo': 'admin',
    'contacto tecnico': 'tech',
    'contacto financiero': 'billing',
  },
  scopeAliases: {
    name: ['Nombre Completo / Representante legal', 'Nombre Completo', 'Nombre'],
    org: ['Razón social'],
    email: ['Correo electrónico', 'Email'],
    country: ['País', 'Pais'],
    city: ['Ciudad'],
    address: ['Dirección', 'Direccion'],
    phone: ['Teléfono', 'Telefono'],
  },
  aliases: {
    domainName: ['NOMBRE DE DOMINIO', 'Dominio'],
    creationDate: ['Fecha de activación', 'Fecha de registro'],
    expirationDate: ['Fecha de corte', 'Fecha de vencimiento'],
  },
};
