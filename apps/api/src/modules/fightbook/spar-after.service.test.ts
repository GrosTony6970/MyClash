import { NotFoundException, type HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  mockSupabase,
  selectsFor,
  writesTo,
  type ChainResult,
} from '../../common/testing/supabase-chain';
import { SparAfterService } from './spar-after.service';

const MARC = '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a01';
const JULIE = '1c8d4b63-8e6a-4b68-8a66-2c2a4a6d3b12';
const PAUL = '2d9e5c74-9f7b-4c79-9b77-3d3b5b7e4c23';
const REQUEST = '5b000000-0000-4000-8000-00000000000a';

// An Event spar on Saturday 23 May 2026 in Paris: the day ends Sunday 06:00 Paris (04:00Z).
const PARIS_ROW = {
  id: REQUEST,
  asker_global_person_id: MARC,
  receiver_global_person_id: JULIE,
  status: 'agreed',
  spar_day: '2026-05-23',
  zone: 'Europe/Paris',
  expires_at: '2026-05-24T04:00:00+00:00',
};
const SATURDAY_MIDNIGHT = new Date('2026-05-22T22:00:00Z');
const SELECT =
  'id, asker_global_person_id, receiver_global_person_id, status, spar_day, zone, expires_at';

function setup(
  update: ChainResult = { data: [{ id: REQUEST }], error: null },
  row: Record<string, unknown> | null = PARIS_ROW,
  send = vi.fn(async () => undefined),
  reread?: ChainResult,
) {
  const supabase = mockSupabase({
    spar_requests: [{ data: row, error: null }, update, ...(reread ? [reread] : [])],
    global_persons: {
      rows: [
        { id: MARC, claimed_by_user_id: 'acc-m' },
        { id: JULIE, claimed_by_user_id: 'acc-j' },
      ],
    },
  });
  Object.assign(supabase, {
    getAuthAdminUser: vi.fn(async () => ({ ok: true, status: 200, data: { email: null } })),
  });
  const service = new SparAfterService(supabase as never, { sendImmediate: send } as never);
  return { service, supabase, send };
}

async function codeOf(promise: Promise<unknown>): Promise<[number, string | undefined]> {
  try {
    await promise;
  } catch (e) {
    const err = e as HttpException;
    return [err.getStatus(), (err.getResponse() as { code?: string }).code];
  }
  return [0, undefined];
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('SparAfterService.markDone', () => {
  it('answers not_open before the spar day starts, and writes nothing', async () => {
    const { service, supabase, send } = setup();
    const early = new Date(SATURDAY_MIDNIGHT.getTime() - 1);
    expect(await codeOf(service.markDone(MARC, REQUEST, early))).toEqual([409, 'not_open']);
    expect(writesTo(supabase, 'spar_requests')).toHaveLength(0);
    await settle();
    expect(send).not.toHaveBeenCalled();
  });

  it('marks from the first instant of the day, as the caller’s side, within two days', async () => {
    const { service, supabase } = setup();
    await service.markDone(JULIE, REQUEST, SATURDAY_MIDNIGHT);
    expect(selectsFor(supabase.from, 'spar_requests')[0]).toBe(SELECT);
    const [write] = writesTo(supabase, 'spar_requests');
    expect(write?.row).toEqual({ status: 'done' });
    expect(write?.filters.map((f) => f.args)).toEqual([
      ['id', REQUEST],
      ['status', 'agreed'],
      ['receiver_global_person_id', JULIE],
      ['expires_at', '2026-05-20T22:00:00.000Z'],
    ]);
  });

  it('tells the other fighter, started and not awaited', async () => {
    const never = vi.fn(() => new Promise<undefined>(() => undefined));
    const { service } = setup(undefined, undefined, never);
    await service.markDone(MARC, REQUEST, SATURDAY_MIDNIGHT);
    await settle();
    expect(never).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'spar_marked_done', entityId: REQUEST, userId: 'acc-j' }),
    );
  });

  it('answers 404 to a stranger, and writes nothing', async () => {
    const { service, supabase } = setup();
    await expect(service.markDone(PAUL, REQUEST, SATURDAY_MIDNIGHT)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(writesTo(supabase, 'spar_requests')).toHaveLength(0);
  });

  it('answers not_open when the update lands on no row (a cancel won, or two days passed)', async () => {
    const { service, send } = setup({ data: [], error: null });
    expect(await codeOf(service.markDone(MARC, REQUEST, SATURDAY_MIDNIGHT))).toEqual([
      409,
      'not_open',
    ]);
    await settle();
    expect(send).not.toHaveBeenCalled();
  });
});

describe('SparAfterService.undo', () => {
  it('puts a done spar back to agreed, either side, within two days, and tells nobody', async () => {
    const { service, supabase, send } = setup();
    await service.undo(MARC, REQUEST, new Date('2026-05-25T12:00:00Z'));
    expect(selectsFor(supabase.from, 'spar_requests')[0]).toBe(SELECT);
    const [write] = writesTo(supabase, 'spar_requests');
    expect(write?.row).toEqual({ status: 'agreed' });
    expect(write?.filters.map((f) => f.args)).toEqual([
      ['id', REQUEST],
      ['status', 'done'],
      ['asker_global_person_id', MARC],
      ['expires_at', '2026-05-23T12:00:00.000Z'],
    ]);
    await settle();
    expect(send).not.toHaveBeenCalled();
  });

  it('answers 404 to a stranger and not_open to a spar no longer done or past its window', async () => {
    const stranger = setup();
    await expect(stranger.service.undo(PAUL, REQUEST)).rejects.toBeInstanceOf(NotFoundException);
    const late = setup({ data: [], error: null });
    expect(await codeOf(late.service.undo(MARC, REQUEST))).toEqual([409, 'not_open']);
  });
});

/**
 * Marc and Julie both tap "We sparred" seconds apart: Marc's update wins, Julie's matches no row.
 * What she asked for happened, so she gets no refusal: the row is read again on her side.
 */
describe('a tap the partner already made', () => {
  const MISSED = { data: [], error: null };
  const now = (status: string) => ({ data: { ...PARIS_ROW, status }, error: null });
  const SUNDAY = new Date('2026-05-24T12:00:00Z');
  const MARK_UNTIL = new Date('2026-05-26T04:00:00Z');

  it('a mark on a spar already done, window open, answers 204 and tells nobody again', async () => {
    const { service, supabase, send } = setup(MISSED, PARIS_ROW, undefined, now('done'));
    await expect(service.markDone(JULIE, REQUEST, SUNDAY)).resolves.toBeUndefined();
    await settle();
    expect(send).not.toHaveBeenCalled();
    expect(writesTo(supabase, 'spar_requests')).toHaveLength(1);
    expect(selectsFor(supabase.from, 'spar_requests')).toEqual([
      SELECT,
      'id',
      'status, expires_at',
    ]);
    // The re-read is the third query on the table: the caller's own spar, on the caller's side.
    const reread = supabase.from.mock.results[2]!.value as { eq: { mock: { calls: unknown[] } } };
    expect(reread.eq.mock.calls).toEqual([
      ['id', REQUEST],
      ['receiver_global_person_id', JULIE],
    ]);
  });

  it('an undo on a spar already agreed, window open, answers 204', async () => {
    const { service } = setup(MISSED, { ...PARIS_ROW, status: 'done' }, undefined, now('agreed'));
    await expect(service.undo(MARC, REQUEST, SUNDAY)).resolves.toBeUndefined();
  });

  it('a mark on a spar already done once the window shut answers not_open', async () => {
    const { service } = setup(MISSED, PARIS_ROW, undefined, now('done'));
    expect(await codeOf(service.markDone(JULIE, REQUEST, MARK_UNTIL))).toEqual([409, 'not_open']);
  });

  it('a mark on a spar the partner cancelled answers not_open', async () => {
    const { service, send } = setup(MISSED, PARIS_ROW, undefined, now('cancelled'));
    expect(await codeOf(service.markDone(JULIE, REQUEST, SUNDAY))).toEqual([409, 'not_open']);
    await settle();
    expect(send).not.toHaveBeenCalled();
  });
});
