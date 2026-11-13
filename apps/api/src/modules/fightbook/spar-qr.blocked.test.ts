import { describe, expect, it, vi } from 'vitest';
import {
  filtersFor,
  mockSupabase,
  queriedTables,
  selectsFor,
} from '../../common/testing/supabase-chain';
import type { QrScanInput } from './spar-qr.service';
import {
  CODE,
  JULIE,
  JULIE_ACCOUNT,
  MARC,
  NOW,
  REQUEST,
  logged,
  qrLogArgs,
  qrWorld,
  settle,
} from './spar-qr.fixtures';
import { SparReadsService } from './spar-reads.service';
import { SparThanksService } from './spar-thanks.service';

/**
 * Ruling 714: a scan by someone the shower blocked never reaches her (no notice, not in her
 * Inbox), and the scanner sees exactly a request she ignored: the same answer, as fast, then
 * "sent" until its day ends and "Not this time" after.
 */
const elsewhere: QrScanInput = {
  code: CODE,
  weapons: ['Longsword'],
  place: 'Salle Probe',
  zone: 'Europe/Paris',
};

describe('SparQrService.scan, the answer and the notice', () => {
  it('answers { id } only, the same whether the shower is told or not', async () => {
    const told = await qrWorld({ answer: logged(true) }).qr.scan(MARC, elsewhere, NOW);
    const untold = await qrWorld({ answer: logged(false) }).qr.scan(MARC, elsewhere, NOW);
    expect(told).toEqual({ id: REQUEST });
    expect(untold).toEqual(told);
    expect(Object.keys(untold)).toEqual(['id']);
  });

  it('tells the shower of a new request when the database says so', async () => {
    const { qr, supabase, send } = qrWorld({ answer: logged(true) });
    await qr.scan(MARC, elsewhere, NOW);
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'spar_request_received',
        entityId: REQUEST,
        userId: JULIE_ACCOUNT,
        preference: 'fightbook',
      }),
    );
    // The database answers the request's id only: the shower is read from it, by its id.
    expect(selectsFor(supabase.from, 'spar_requests')).toEqual(['receiver_global_person_id']);
    expect(filtersFor(supabase.from, 'spar_requests', 'eq')).toEqual([['id', REQUEST]]);
  });

  it('tells nobody, and reads nothing more, when she blocked the scanner', async () => {
    const { qr, supabase, send } = qrWorld({ answer: logged(false) });
    await qr.scan(MARC, elsewhere, NOW);
    await settle();
    expect(send).not.toHaveBeenCalled();
    expect(queriedTables(supabase.from)).not.toContain('spar_requests');
  });

  it('sends nothing, and still answers, when the request is gone before the notice reads it', async () => {
    // An erasure between the insert and the notice: the id the database answered reads nothing.
    const gone = '5b000000-0000-4000-8000-0000000000ee';
    const { qr, send } = qrWorld({ answer: { data: { id: gone, notify: true }, error: null } });
    const answer = await qr.scan(MARC, elsewhere, NOW);
    await settle();
    expect(answer).toEqual({ id: gone });
    expect(send).not.toHaveBeenCalled();
  });

  it('answers before the notice settles: a blocked scan, which sends none, is no faster', async () => {
    const never = vi.fn(() => new Promise<undefined>(() => undefined));
    const { qr } = qrWorld({ answer: logged(true), send: never });
    const answered = await Promise.race([
      qr.scan(MARC, elsewhere, NOW).then(() => 'answered'),
      new Promise((resolve) => setTimeout(() => resolve('waited'), 50)),
    ]);
    expect(answered).toBe('answered');
    // The notice really was under way: the send was reached, and it never settles.
    await vi.waitFor(() => expect(never).toHaveBeenCalled());
  });
});

const live = {
  claimed_by_user_id: JULIE_ACCOUNT,
  fightbook_enabled: true,
  deleted_at: null,
  merged_into_id: null,
  account_deleted_at: null,
};

/** Marc's scan of Julie's code, and the Inbox and My spars over what the database then holds. */
async function afterScan(julieBlockedMarc: boolean, sweptAs?: 'not_this_time') {
  const scan = qrWorld({ answer: logged(!julieBlockedMarc) });
  const answer = await scan.qr.scan(MARC, elsewhere, NOW);
  const args = qrLogArgs(scan.supabase);
  // The row `fightbook_qr_log` inserts from this payload (0270): pending always, whoever blocked
  // whom; the hourly sweep later ends it `not_this_time`, as any unanswered ask.
  const row = {
    id: answer.id,
    asker_global_person_id: args.p_scanner,
    receiver_global_person_id: JULIE,
    kind: args.p_kind,
    event_id: args.p_event_id,
    spar_day: args.p_spar_day,
    zone: args.p_zone,
    spar_time: null,
    place: args.p_place,
    weapons: args.p_weapons,
    message: null,
    status: sweptAs ?? 'pending',
    expires_at: args.p_expires_at,
    shared_comment: null,
    cancelled_by: null,
    cancel_message: null,
  };
  const db = mockSupabase({
    spar_requests: { rows: [row] },
    fightbook_blocks: {
      rows: julieBlockedMarc
        ? [{ id: 'b-1', blocker_global_person_id: JULIE, blocked_global_person_id: MARC }]
        : [],
    },
    global_persons: {
      rows: [
        { id: MARC, ...live, given_name: 'Marc', family_name: 'Probe', display_name: null },
        { id: JULIE, ...live, given_name: 'Julie', family_name: 'Probe', display_name: null },
      ],
    },
    events: { rows: [] },
    spar_thanks: { rows: [] },
    spar_anonymous_reviews: { rows: [] },
    spar_private_notes: { rows: [] },
    spar_flags: { rows: [] },
  });
  const reads = new SparReadsService(db as never, new SparThanksService(db as never));
  return { answer, reads, ends: new Date(String(args.p_expires_at)) };
}

describe('a scan by a fighter the shower blocked (ruling 714)', () => {
  it('reads for the scanner exactly as an ignored request: sent, then Not this time', async () => {
    const blocked = await afterScan(true);
    const open = await afterScan(false);
    expect(blocked.answer).toEqual(open.answer);

    const before = new Date(blocked.ends.getTime() - 60_000);
    const sentBefore = await blocked.reads.mySpars(MARC, true, before);
    expect(sentBefore).toEqual(await open.reads.mySpars(MARC, true, before));
    expect(sentBefore.sent.map((s) => [s.id, s.status])).toEqual([[REQUEST, 'pending']]);

    const after = new Date(blocked.ends.getTime() + 60_000);
    const sentAfter = await blocked.reads.mySpars(MARC, true, after);
    expect(sentAfter).toEqual(await open.reads.mySpars(MARC, true, after));
    expect(sentAfter.sent.map((s) => [s.id, s.status])).toEqual([[REQUEST, 'not_this_time']]);
  });

  it('reads the same once the hourly sweep has ended it', async () => {
    const blocked = await afterScan(true, 'not_this_time');
    const open = await afterScan(false, 'not_this_time');
    const after = new Date(blocked.ends.getTime() + 60_000);
    const swept = await blocked.reads.mySpars(MARC, true, after);
    expect(swept).toEqual(await open.reads.mySpars(MARC, true, after));
    expect(swept).toEqual(await (await afterScan(true)).reads.mySpars(MARC, true, after));
  });

  it('never reaches her Inbox; an unblocked scan does', async () => {
    const blocked = await afterScan(true);
    const open = await afterScan(false);
    expect(await blocked.reads.inbox(JULIE, NOW)).toEqual([]);
    expect((await open.reads.inbox(JULIE, NOW)).map((r) => r.id)).toEqual([REQUEST]);
  });
});
