/**
 * What each fighter sees of today's open calls at an Event (FightBook slice 5, Decision 8,
 * rulings 706 and 712). Every filter on a block is the CALLER's own (`blockedBy`): whether someone
 * blocked the caller is never read, so a blocked fighter's lists equal anyone's (ruling 672).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { MyOpenCall, OpenCallView, OpenCallsAtEvent, SparFighter } from '@myclash/types';
import { IN_LIST_MAX } from '../../common/postgrest-in-list';
import {
  OPEN_CALL_COLUMNS,
  callIsOpen,
  callState,
  callTime,
  myAnswerOn,
  type OpenCallRow,
} from './open-call-views';
import { blockedBy, fightBookOnFighters } from './spar-askable';
import { readSparFighters, unknownSparFighter } from './spar-fighters';

type Db = Pick<SupabaseClient, 'from'>;

/**
 * The bounds of the read (Decision 6). `others`: at most 100, soonest first; the write side is
 * bounded by 5 OPEN calls per poster per day times the roster. A call's answers: at most 50,
 * oldest first; bounded by the roster. `mine`: my 20 newest calls of the day (5 open at a time,
 * the rest closed or picked), the open ones with their answers. The calls I answered: my 100
 * newest answers (the hourly sweep deletes a call, and its answers, a day after it closes).
 */
export const OTHERS_MAX = 100;
export const ANSWERS_MAX = 50;
export const MINE_MAX = 20;

/** A builder's `not … in`, through a view (the TS2589 note in `spar-askable.ts`). */
interface NotInFilter<T> {
  not(column: string, operator: 'in', value: string): T;
}

/** Leave out rows naming the fighters the caller blocked, in the query, so a cap stays full. */
function withoutBlocked<T>(query: T, column: string, blocked: Set<string>): T {
  const listed = [...blocked].slice(0, IN_LIST_MAX);
  if (listed.length === 0) return query;
  return (query as unknown as NotInFilter<T>).not(column, 'in', `(${listed.join(',')})`);
}

const bySoonest = (a: OpenCallRow, b: OpenCallRow) =>
  a.closes_at.localeCompare(b.closes_at) || a.id.localeCompare(b.id);

function rowsOf(what: string, answer: { data: unknown; error: { message: string } | null }) {
  if (answer.error) throw new Error(`FightBook ${what} read failed: ${answer.error.message}`);
  return (answer.data ?? []) as OpenCallRow[];
}

/** My calls of today at this Event, whatever their state: my `MINE_MAX` newest. */
async function myCalls(db: Db, me: string, eventId: string, today: string) {
  const answer = await db
    .from('spar_open_calls')
    .select(OPEN_CALL_COLUMNS)
    .eq('poster_global_person_id', me)
    .eq('event_id', eventId)
    .eq('spar_day', today)
    .order('created_at', { ascending: false })
    .limit(MINE_MAX);
  return rowsOf('my open calls', answer).sort(bySoonest);
}

/** Other posters' OPEN calls at this Event today, minus those I blocked, soonest first. */
async function othersOpen(
  db: Db,
  me: string,
  eventId: string,
  today: string,
  now: Date,
  blocked: Set<string>,
) {
  const query = db
    .from('spar_open_calls')
    .select(OPEN_CALL_COLUMNS)
    .eq('event_id', eventId)
    .eq('spar_day', today)
    .eq('status', 'open')
    .gt('closes_at', now.toISOString())
    .neq('poster_global_person_id', me);
  const answer = await withoutBlocked(query, 'poster_global_person_id', blocked)
    .order('closes_at', { ascending: true })
    .limit(OTHERS_MAX);
  return rowsOf('open calls', answer);
}

/** The calls I answered "I'm in": their ids, my newest `OTHERS_MAX`. */
async function myAnsweredIds(db: Db, me: string): Promise<Set<string>> {
  const { data, error } = await db
    .from('spar_open_call_answers')
    .select('call_id')
    .eq('answerer_global_person_id', me)
    .order('created_at', { ascending: false })
    .limit(OTHERS_MAX);
  if (error) throw new Error(`FightBook my answers read failed: ${error.message}`);
  return new Set(((data ?? []) as Array<{ call_id: string }>).map((row) => row.call_id));
}

/** The calls of today at this Event I answered, whatever their state, not already read. */
async function answeredCalls(
  db: Db,
  eventId: string,
  today: string,
  answered: Set<string>,
  read: OpenCallRow[],
) {
  const have = new Set(read.map((row) => row.id));
  const ids = [...answered].filter((id) => !have.has(id));
  if (ids.length === 0) return [];
  const answer = await db
    .from('spar_open_calls')
    .select(OPEN_CALL_COLUMNS)
    .in('id', ids)
    .eq('event_id', eventId)
    .eq('spar_day', today);
  return rowsOf('answered calls', answer);
}

/** Who answered each of my OPEN calls, oldest first, at most `ANSWERS_MAX`, minus my blocks. */
async function answersOf(db: Db, calls: OpenCallRow[], blocked: Set<string>) {
  const lists = await Promise.all(
    calls.map(async (call) => {
      const query = db
        .from('spar_open_call_answers')
        .select('answerer_global_person_id')
        .eq('call_id', call.id);
      const { data, error } = await withoutBlocked(query, 'answerer_global_person_id', blocked)
        .order('created_at', { ascending: true })
        .limit(ANSWERS_MAX);
      if (error) throw new Error(`FightBook call answers read failed: ${error.message}`);
      const rows = (data ?? []) as Array<{ answerer_global_person_id: string }>;
      return [call.id, rows.map((row) => row.answerer_global_person_id)] as const;
    }),
  );
  return new Map<string, readonly string[]>(lists);
}

/**
 * Today's open calls at an Event for `me` (Decision 8), the Event gate already passed. `mine`:
 * each call with who answered (on FightBook, not blocked by me) while it is open, and whom I
 * picked. `others`: the OPEN calls of posters on FightBook I did not block, and every call of
 * today I answered, each with my answer only: no count, no other answerer (ruling 712).
 */
export async function readOpenCalls(
  db: Db,
  me: string,
  eventId: string,
  today: string,
  now: Date,
): Promise<OpenCallsAtEvent> {
  const blocked = await blockedBy(db, me);
  const [mine, open, answered] = await Promise.all([
    myCalls(db, me, eventId, today),
    othersOpen(db, me, eventId, today, now, blocked),
    myAnsweredIds(db, me),
  ]);
  const seen = [...open, ...(await answeredCalls(db, eventId, today, answered, open))];
  const answers = await answersOf(
    db,
    mine.filter((call) => callIsOpen(call, now)),
    blocked,
  );
  const ids = [
    ...seen.map((call) => call.poster_global_person_id),
    ...[...answers.values()].flat(),
    ...mine.flatMap((call) => call.picked_global_person_id ?? []),
  ];
  const [on, fighters] = await Promise.all([
    fightBookOnFighters(db, ids),
    readSparFighters(db, ids),
  ]);
  const card = (id: string): SparFighter => fighters.get(id) ?? unknownSparFighter(id);
  const others = seen
    .filter((call) => on.has(call.poster_global_person_id))
    .filter((call) => !blocked.has(call.poster_global_person_id))
    .sort(bySoonest)
    .slice(0, OTHERS_MAX)
    .map((call) => toOther(call, card(call.poster_global_person_id), me, answered, now));
  return {
    mine: mine.map((call) => toMine(call, answers.get(call.id) ?? [], on, blocked, card, now)),
    others,
  };
}

function toOther(
  call: OpenCallRow,
  poster: SparFighter,
  me: string,
  answered: Set<string>,
  now: Date,
): OpenCallView {
  return {
    id: call.id,
    poster,
    weapons: call.weapons,
    time: callTime(call.spar_time),
    open: callIsOpen(call, now),
    myAnswer: myAnswerOn(call, me, answered.has(call.id), now),
  };
}

/**
 * My call as I see it. The answerers I blocked are dropped here too: the query names only the
 * first `IN_LIST_MAX` of my blocks (`withoutBlocked`), so past them this is the only filter.
 */
function toMine(
  call: OpenCallRow,
  answerers: readonly string[],
  on: Set<string>,
  blocked: Set<string>,
  card: (id: string) => SparFighter,
  now: Date,
): MyOpenCall {
  return {
    id: call.id,
    weapons: call.weapons,
    time: callTime(call.spar_time),
    state: callState(call, now),
    picked: call.picked_global_person_id ? card(call.picked_global_person_id) : null,
    answers: answerers.filter((id) => on.has(id) && !blocked.has(id)).map(card),
  };
}
