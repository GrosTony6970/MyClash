import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { lastFunctionParams } from '../../common/testing/migration-function';
import { filtersFor, queriedTables, selectsFor } from '../../common/testing/supabase-chain';
import { hashPassToken } from '../checkin/pass-token';
import { sparExpiresAt } from './spar-ask-rules';
import type { QrScanInput } from './spar-qr.service';
import {
  CODE,
  EVENT,
  MARC,
  NOW,
  publicEvent,
  qrLogArgs,
  qrWorld,
  refusalOf,
} from './spar-qr.fixtures';

const atEvent: QrScanInput = { code: CODE, weapons: ['longsword ', 'Sabre'], eventId: EVENT };
const elsewhere: QrScanInput = {
  code: CODE,
  weapons: ['Longsword'],
  place: 'Salle Probe',
  zone: 'Pacific/Auckland',
};

describe('SparQrService.scan, the payload', () => {
  it('sends exactly the parameters fightbook_qr_log takes', async () => {
    const { qr, supabase } = qrWorld();
    await qr.scan(MARC, elsewhere, NOW);
    expect(supabase.rpc.mock.calls.map(([name]) => name)).toEqual(['fightbook_qr_log']);
    expect(Object.keys(qrLogArgs(supabase)).sort()).toEqual(
      lastFunctionParams('fightbook_qr_log').sort(),
    );
  });

  it('at an Event: the Event’s today and zone, no place, the hash of the secret only', async () => {
    const { qr, supabase } = qrWorld();
    await qr.scan(MARC, atEvent, NOW);
    expect(qrLogArgs(supabase)).toEqual({
      p_token_hash: hashPassToken(CODE.slice(3)),
      p_scanner: MARC,
      p_kind: 'event',
      p_event_id: EVENT,
      p_spar_day: '2026-05-23',
      p_zone: 'America/New_York',
      p_place: null,
      p_weapons: ['Longsword', 'Sabre'],
      p_expires_at: sparExpiresAt('event', '2026-05-23', 'America/New_York')!.toISOString(),
    });
    expect(JSON.stringify(qrLogArgs(supabase))).not.toContain(CODE.slice(3));
    // The Event read and the roster read name this Event and the scanner.
    expect(filtersFor(supabase.from, 'events', 'eq')).toEqual([['id', EVENT]]);
    expect(filtersFor(supabase.from, 'persons', 'eq')).toEqual([
      ['event_id', EVENT],
      ['global_person_id', MARC],
    ]);
    expect(selectsFor(supabase.from, 'weapon_catalog')).toEqual(['name']);
  });

  it('elsewhere: today on the phone’s clock (Sunday in Auckland, Saturday in UTC)', async () => {
    const { qr, supabase } = qrWorld();
    await qr.scan(MARC, elsewhere, NOW);
    expect(qrLogArgs(supabase)).toEqual({
      p_token_hash: hashPassToken(CODE.slice(3)),
      p_scanner: MARC,
      p_kind: 'free',
      p_event_id: null,
      p_spar_day: '2026-05-24',
      p_zone: 'Pacific/Auckland',
      p_place: 'Salle Probe',
      p_weapons: ['Longsword'],
      p_expires_at: sparExpiresAt('free', '2026-05-24', 'Pacific/Auckland')!.toISOString(),
    });
    expect(queriedTables(supabase.from)).not.toContain('events');
  });
});

describe('SparQrService.scan, refused before the code is spent', () => {
  it('refuses a code without fb: before reading anything', async () => {
    const { qr, supabase } = qrWorld();
    for (const code of [CODE.slice(3), `FB:${CODE.slice(3)}`, 'https://example.test/fb:x']) {
      expect(await refusalOf(qr.scan(MARC, { ...elsewhere, code }, NOW))).toEqual([
        400,
        'bad_code',
      ]);
    }
    expect(supabase.from).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it.each([
    [
      'a weapon off the catalog',
      { ...elsewhere, weapons: ['Rapier'] as string[] },
      'bad_weapon',
      {},
    ],
    ['no place', { ...elsewhere, place: undefined }, 'bad_place', {}],
    ['no zone', { ...elsewhere, zone: undefined }, 'bad_zone', {}],
    ['an unknown zone', { ...elsewhere, zone: 'Mars/Olympus' }, 'bad_zone', {}],
    ['an Event I am not at', atEvent, 'bad_event', { roster: false }],
    ['an unknown Event', atEvent, 'bad_event', { event: null }],
    ['a draft Event', atEvent, 'bad_event', { event: { ...publicEvent, status: 'draft' } }],
    [
      'an Event with no day open today',
      atEvent,
      'bad_event',
      { event: { ...publicEvent, start_date: '2026-06-01', end_date: '2026-06-02' } },
    ],
  ] as const)(
    'refuses %s (%s) without calling the database function',
    async (_, input, word, world) => {
      const { qr, supabase, send } = qrWorld(world);
      expect(await refusalOf(qr.scan(MARC, input, NOW))).toEqual([400, word]);
      expect(supabase.rpc).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    },
  );
});

describe('SparQrService.scan, the database’s refusals', () => {
  it.each([
    ['bad_code', BadRequestException, 400],
    ['bad_event', BadRequestException, 400],
    ['self', BadRequestException, 400],
    ['already_asked', ConflictException, 409],
    ['fightbook_off', ForbiddenException, 403],
    ['not_on_fightbook', ForbiddenException, 403],
    ['you_blocked', ForbiddenException, 403],
  ] as const)('answers %s as an ask does', async (word, type, status) => {
    const answer = { data: null, error: { code: 'P0001', message: word } };
    const { qr, send } = qrWorld({ answer });
    await expect(qr.scan(MARC, elsewhere, NOW)).rejects.toBeInstanceOf(type);
    expect(await refusalOf(qr.scan(MARC, elsewhere, NOW))).toEqual([status, word]);
    expect(send).not.toHaveBeenCalled();
  });

  it('turns any other database error into a 5xx', async () => {
    const { qr } = qrWorld({ answer: { data: null, error: { code: 'XX000', message: 'boom' } } });
    await expect(qr.scan(MARC, elsewhere, NOW)).rejects.toThrow('boom');
  });
});
