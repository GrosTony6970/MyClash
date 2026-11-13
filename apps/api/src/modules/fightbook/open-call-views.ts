/**
 * Open calls (FightBook slice 5, Decisions 5 and 8): what a call row reads as. Pure, so the reads,
 * the pick's caller and the notice check (`alert-still-wanted.ts`) share one meaning of OPEN.
 */
import type { MyOpenCall, OpenCallAnswer } from '@myclash/types';

/** The words stored in `spar_open_calls.status` (its CHECK `spar_open_calls_status_shape`). */
export type OpenCallStatus = 'open' | 'picked' | 'closed';

/** The `spar_open_calls` columns every read of a call selects (`OPEN_CALL_COLUMNS`). */
export interface OpenCallRow {
  id: string;
  poster_global_person_id: string;
  weapons: string[];
  spar_time: string;
  status: OpenCallStatus;
  picked_global_person_id: string | null;
  closes_at: string;
}

export const OPEN_CALL_COLUMNS =
  'id, poster_global_person_id, weapons, spar_time, status, picked_global_person_id, closes_at';

/**
 * OPEN: `status = 'open' AND closes_at > now()`. Nothing flips the status at `closes_at`, so every
 * read uses this and the SQL clause (the reads' filters, `fightbook_call_pick`'s UPDATE,
 * `fightbook_call_take_back`'s re-read) is the same one. The TypeScript owner of it.
 */
export function callIsOpen(call: Pick<OpenCallRow, 'status' | 'closes_at'>, now: Date): boolean {
  return call.status === 'open' && new Date(call.closes_at).getTime() > now.getTime();
}

/** The poster's own view of a call: open until its time or a close, then closed; or picked. */
export function callState(
  call: Pick<OpenCallRow, 'status' | 'closes_at'>,
  now: Date,
): MyOpenCall['state'] {
  switch (call.status) {
    case 'open':
      return callIsOpen(call, now) ? 'open' : 'closed';
    case 'picked':
      return 'picked';
    case 'closed':
      return 'closed';
  }
}

/**
 * Where `me` stands on someone else's call (ruling 706): `picked` when the poster chose `me`;
 * otherwise `none` when `me` did not answer; `in` while an answered call is open; `not_this_time`
 * once it closed or went to someone else. The same for a fighter the poster blocked: her block
 * hides his answer from her and the pick refuses him, so his call reads as every unpicked answer does.
 */
export function myAnswerOn(
  call: Pick<OpenCallRow, 'status' | 'closes_at' | 'picked_global_person_id'>,
  me: string,
  answered: boolean,
  now: Date,
): OpenCallAnswer {
  switch (call.status) {
    case 'picked':
      if (call.picked_global_person_id === me) return 'picked';
      return answered ? 'not_this_time' : 'none';
    case 'open':
      if (!answered) return 'none';
      return callIsOpen(call, now) ? 'in' : 'not_this_time';
    case 'closed':
      return answered ? 'not_this_time' : 'none';
  }
}

/** A call's time as the web shows it, `HH:MM` (Postgres answers a `time` as `HH:MM:SS`). */
export const callTime = (sparTime: string): string => sparTime.slice(0, 5);
