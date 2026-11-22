// the eppStatus / eppStatusRaw pair (docs/archive/domain-availability.md §1a). statusFormatter owns
// the promise the field NAME makes — canonical EPP codes, nothing else — and rawStatusFormatter
// owns the other half, what the registry actually wrote. these pin the two apart, because the
// easy mistake is to run the raw side through arrayFormatter and quietly lose order, duplicates,
// bracketed text and case.
import { describe, it, expect } from 'vitest';
import { statusFormatter, rawStatusFormatter } from '../../src/whois/base';
import { DOMAIN_QUERY_TYPE } from '../../src/common/constants';

const status = (value: string | string[]) => statusFormatter(value, 'eppStatus', DOMAIN_QUERY_TYPE);
const raw = (value: string | string[]) =>
  rawStatusFormatter(value, 'eppStatusRaw', DOMAIN_QUERY_TYPE);

describe('statusFormatter', () => {
  it('keeps canonical EPP codes', () => {
    expect(status(['clientTransferProhibited', 'ok'])).toEqual(['clientTransferProhibited', 'ok']);
  });

  it('canonicalizes case and the spaced forms', () => {
    expect(status(['CLIENT DELETE PROHIBITED', 'CLIENTTRANSFERPROHIBITED'])).toEqual([
      'clientDeleteProhibited',
      'clientTransferProhibited',
    ]);
    // whois.hkirc.hk and friends report `Active`, which is the registry's way of saying `ok`
    expect(status('Active')).toEqual(['ok']);
  });

  // `by Registry` / `by Registrar` says which side set the lock, which is exactly the
  // client-vs-server distinction EPP encodes — whois.je reported four of these and only `Active`
  // used to survive
  it('maps the qualified prohibitions to their client/server codes', () => {
    expect(
      status([
        'Active',
        'Transfer Prohibited by Registry',
        'Update Prohibited by Registry',
        'Delete Prohibited by Registry',
      ])
    ).toEqual([
      'ok',
      'serverDeleteProhibited',
      'serverTransferProhibited',
      'serverUpdateProhibited',
    ]);
    expect(status('Delete Prohibited by Registrar')).toEqual(['clientDeleteProhibited']);
  });

  it('ignores underscores and hyphens between the words', () => {
    expect(status('client_delete_prohibited, client_update_prohibited')).toEqual([
      'clientDeleteProhibited',
      'clientUpdateProhibited',
    ]);
    // but a space still matters: `update prohibited` is an unqualified guess at clientUpdate*,
    // and the unspaced form must not inherit it
    expect(status('UpdateProhibited')).toEqual([]);
  });

  it('maps the French spellings of active, in either unicode form', () => {
    expect(status('actif')).toEqual(['ok']);
    // spelled with escapes because the two forms are indistinguishable on screen: whois.nic.tg
    // sends the precomposed U+00E9, but the decomposed `e` + U+0301 renders identically, and
    // normalizing to NFC is what collapses them onto the same map key
    expect(status('Activ\u00e9')).toEqual(['ok']);
    expect(status('Active\u0301')).toEqual(['ok']);
  });

  it('strips the epp link and the registry gloss before mapping', () => {
    expect(status('clientDeleteProhibited https://icann.org/epp#clientDeleteProhibited')).toEqual([
      'clientDeleteProhibited',
    ]);
    expect(status('ok - Normal state.')).toEqual(['ok']);
  });

  // the point of the rename: a field called eppStatus holds EPP codes, so a ccTLD's own
  // vocabulary is dropped here rather than passed through in whatever case it arrived
  it('drops values that are not EPP codes', () => {
    expect(status(['RESERVED', 'connect'])).toEqual([]);
    expect(status(['clientTransferProhibited', 'Registered until cancelled'])).toEqual([
      'clientTransferProhibited',
    ]);
  });

  it('returns an empty array for empty input', () => {
    expect(status('')).toEqual([]);
    expect(status([])).toEqual([]);
  });
});

describe('rawStatusFormatter', () => {
  it('keeps the registry text verbatim, link and gloss included', () => {
    expect(raw('clientDeleteProhibited https://icann.org/epp#clientDeleteProhibited')).toEqual([
      'clientDeleteProhibited https://icann.org/epp#clientDeleteProhibited',
    ]);
    expect(raw('ok - Normal state.')).toEqual(['ok - Normal state.']);
  });

  it('keeps values arrayFormatter would have destroyed', () => {
    // no case folding, no dedupe: two identical lines in the response really were two lines
    expect(raw(['RESERVED', 'RESERVED', 'Ok', 'ok'])).toEqual(['RESERVED', 'RESERVED', 'Ok', 'ok']);
    // no bracket/paren stripping, and no comma splitting
    expect(raw('Registered until cancelled (2026), locked')).toEqual([
      'Registered until cancelled (2026), locked',
    ]);
    // no sorting — source order survives
    expect(raw(['serverHold', 'clientHold', 'addPeriod'])).toEqual([
      'serverHold',
      'clientHold',
      'addPeriod',
    ]);
  });

  it('splits on newlines and drops empties', () => {
    expect(raw('Active\n\nTransfer Prohibited by Registry\n')).toEqual([
      'Active',
      'Transfer Prohibited by Registry',
    ]);
  });

  it('returns an empty array for empty input', () => {
    expect(raw('')).toEqual([]);
    expect(raw([])).toEqual([]);
  });
});
