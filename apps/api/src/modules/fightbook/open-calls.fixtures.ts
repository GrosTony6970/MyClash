/**
 * The open-call test world (FightBook slice 5, Task 5): an Event on Saturday and Sunday
 * 2026-05-23/24 in New York (UTC-4 in May), with Marc, Julie and Paul on its roster. Test-only.
 */
import type { HttpException } from '@nestjs/common';
import { vi, type Mock } from 'vitest';
import {
  mockSupabase,
  type SupabaseRow,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { OpenCallsService } from './open-calls.service';
import type { SparNoticeDeps } from './spar-notices';

export const MARC = '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a01';
export const JULIE = '1c8d4b63-8e6a-4b68-8a66-2c2a4a6d3b12';
export const PAUL = '2d9e5c74-9f7b-4c79-9b77-3d3b5b7e4c23';
export const LEA = '3e0f6d85-0a8c-4d8a-8c88-4e4c6c8f5d34';
export const EVENT = 'eeeeeeee-0000-4000-8000-00000000000a';
export const DRAFT_EVENT = 'eeeeeeee-0000-4000-8000-00000000000c';
export const LATER_EVENT = 'eeeeeeee-0000-4000-8000-00000000000d';
export const NEW_CALL = 'ca000000-0000-4000-8000-0000000000ff';
export const SPAR = '5b000000-0000-4000-8000-00000000000a';
export const ACCOUNT_OF: Record<string, string> = {
  [MARC]: '9a8b7c6d-1111-4222-8333-944455566601',
  [JULIE]: '9a8b7c6d-1111-4222-8333-944455566602',
  [PAUL]: '9a8b7c6d-1111-4222-8333-944455566603',
  [LEA]: '9a8b7c6d-1111-4222-8333-944455566604',
};

/** Saturday 14:00 in New York. */
export const NOW = new Date('2026-05-23T18:00:00Z');
export const TODAY = '2026-05-23';

export const event = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  status: 'published',
  organization_id: 'org-a',
  event_kind: 'standard',
  start_date: '2026-05-23',
  end_date: '2026-05-24',
  timezone: 'America/New_York',
  ...over,
});

const roster = (eventId: string, gp: string) => ({
  id: `p-${eventId}-${gp}`,
  event_id: eventId,
  global_person_id: gp,
});

/** A live, claimed profile with FightBook on (`applyFightBookOn`), unless `on` is false. */
export const profile = (id: string, name: string, on = true) => ({
  id,
  display_name: name,
  given_name: null,
  family_name: null,
  photo_url: null,
  clubs: null,
  claimed_by_user_id: ACCOUNT_OF[id] ?? null,
  fightbook_enabled: on,
  deleted_at: null,
  merged_into_id: null,
  account_deleted_at: null,
});

/** A call row as stored: Julie's open call at 15:00 today unless told. */
export const callRow = (over: SupabaseRow = {}): SupabaseRow => ({
  id: 'ca000000-0000-4000-8000-000000000001',
  poster_global_person_id: JULIE,
  event_id: EVENT,
  spar_day: TODAY,
  zone: 'America/New_York',
  weapons: ['Longsword'],
  spar_time: '15:00:00',
  status: 'open',
  picked_global_person_id: null,
  spar_request_id: null,
  closes_at: '2026-05-23T19:00:00+00:00',
  created_at: '2026-05-23T17:00:00+00:00',
  ...over,
});

export const answerRow = (callId: string, gp: string, createdAt = '2026-05-23T17:30:00+00:00') => ({
  id: `a-${callId}-${gp}`,
  call_id: callId,
  answerer_global_person_id: gp,
  created_at: createdAt,
});

export const blockRow = (blocker: string, blocked: string) => ({
  id: `b-${blocker}-${blocked}`,
  blocker_global_person_id: blocker,
  blocked_global_person_id: blocked,
});

/** The notices' send, recorded. */
export type Send = Mock<(job: unknown) => Promise<undefined>>;

export interface World {
  calls?: SupabaseRow[];
  answers?: SupabaseRow[];
  blocks?: SupabaseRow[];
  profiles?: SupabaseRow[];
  rosterOf?: string[];
  /** What `fightbook_call_pick` answers; the spar's id unless told. */
  pick?: { data: unknown; error: unknown };
  /** The database's clock for `fightbook_call_take_back`; NOW unless told. */
  dbNow?: Date;
}

/**
 * `fightbook_call_take_back` (0270) over this world's rows: no answer of the caller's on the call
 * is `not_found` (P0002); a call not OPEN on the database's clock is `not_open`; else it lands.
 * It reads no block, no roster and no profile, as the SQL does not.
 */
function takeBackIn(w: World) {
  return (args: Record<string, unknown>) => {
    const refused = (code: string, message: string) => ({ data: null, error: { code, message } });
    const mine = (w.answers ?? []).some(
      (a) => a.call_id === args.p_call && a.answerer_global_person_id === args.p_answerer,
    );
    if (!mine) return refused('P0002', 'not_found') as never;
    const call = (w.calls ?? []).find((c) => c.id === args.p_call);
    const open = call?.status === 'open' && new Date(String(call.closes_at)) > (w.dbNow ?? NOW);
    return (open ? { data: null, error: null } : refused('P0001', 'not_open')) as never;
  };
}

/** The tables of this world. */
function tables(w: World): Record<string, TableSeed> {
  return {
    events: {
      rows: [
        event(EVENT),
        event(DRAFT_EVENT, { status: 'draft' }),
        event(LATER_EVENT, { start_date: '2026-06-20', end_date: '2026-06-21' }),
      ],
    },
    persons: {
      rows: [
        ...(w.rosterOf ?? [MARC, JULIE, PAUL, LEA]).map((gp) => roster(EVENT, gp)),
        roster(DRAFT_EVENT, MARC),
        roster(LATER_EVENT, MARC),
      ],
    },
    weapon_catalog: {
      rows: [
        { name: 'Longsword', active: true },
        { name: 'Sabre', active: true },
        { name: 'Rapier', active: false },
      ],
    },
    spar_open_calls: { rows: w.calls ?? [], returning: { id: NEW_CALL } },
    spar_open_call_answers: { rows: w.answers ?? [] },
    fightbook_blocks: { rows: w.blocks ?? [] },
    global_persons: {
      rows: w.profiles ?? [
        profile(MARC, 'Marc'),
        profile(JULIE, 'Julie'),
        profile(PAUL, 'Paul'),
        profile(LEA, 'Léa'),
      ],
    },
  };
}

/** The service over this world, with the notices' sends recorded. */
export function world(w: World = {}) {
  const supabase = mockSupabase(tables(w), {
    fightbook_call_pick: () => (w.pick ?? { data: SPAR, error: null }) as never,
    fightbook_call_take_back: takeBackIn(w),
  });
  const send: Send = vi.fn(async () => undefined);
  const getAuthAdminUser = vi.fn(async (userId: string) => ({
    ok: true,
    status: 200,
    data: { id: userId, email: 'fighter@example.test' },
  }));
  Object.assign(supabase, { getAuthAdminUser });
  const open = new OpenCallsService(supabase as never, { sendImmediate: send } as never);
  return { open, supabase, send };
}

/** A service whose notices go to `deps` (a send that never settles, for the race tests). */
export function withNoticeDeps(open: OpenCallsService, deps: SparNoticeDeps): OpenCallsService {
  Object.defineProperty(open, 'noticeDeps', { value: () => deps });
  return open;
}

/** The status and `code` an HTTP refusal answers. */
export async function codeOf(promise: Promise<unknown>): Promise<[number, string | undefined]> {
  const error = (await promise.catch((e: unknown) => e)) as HttpException;
  if (typeof error?.getStatus !== 'function') throw error;
  return [error.getStatus(), (error.getResponse() as { code?: string }).code];
}

/** Let the started, un-awaited notices run. */
export const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
