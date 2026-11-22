// EPP status codes (RFC 5731, and the grace-period codes of RFC 3915): the vocabulary every
// domain status is normalised to.
import { isEmpty } from '../common/values';

/** list of valid EPP status values in correct case */
export const EPP_STATUS_VALUES = [
  'ok',
  'addPeriod',
  'linked',
  'autoRenewPeriod',
  'clientHold',
  'clientDeleteProhibited',
  'clientRenewProhibited',
  'clientTransferProhibited',
  'clientUpdateProhibited',
  'inactive',
  'pendingCreate',
  'pendingDelete',
  'pendingRenew',
  'pendingRestore',
  'pendingTransfer',
  'pendingUpdate',
  'redemptionPeriod',
  'renewPeriod',
  'serverDeleteProhibited',
  'serverHold',
  'serverRenewProhibited',
  'serverTransferProhibited',
  'serverUpdateProhibited',
  'transferPeriod',
] as const;

export type EppStatus = (typeof EPP_STATUS_VALUES)[number];

/** type guard for a canonical EPP status code, the single gate every eppStatus field passes */
export function isEppStatus(status: string | null | undefined): status is EppStatus {
  return !isEmpty(status) && EPP_STATUS_VALUES.includes(status as EppStatus);
}
