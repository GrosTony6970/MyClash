import { describe, expect, it } from 'vitest';
import type { SparFighter } from '@myclash/types';
import { filtersFor, queriedTables, selectsFor } from '../../common/testing/supabase-chain';
import {
  DRAFT_EVENT,
  EVENT,
  JULIE,
  LATER_EVENT,
  LEA,
  MARC,
  NOW,
  PAUL,
  TODAY,
  answerRow,
  blockRow,
  callRow,
  codeOf,
  profile,
  world,
  type World,
} from './open-calls.fixtures';
import { ANSWERS_MAX, MINE_MAX, OTHERS_MAX } from './open-call-reads';

const id = (n: number) => `ca000000-0000-4000-8000-00000000000${n}`;
const fighter = (gp: string, name: string): SparFighter => ({
  globalPersonId: gp,
  name,
  photoUrl: null,
  club: null,
});

// Julie's open call at 15:00, Marc and Paul in; Paul's at 16:00; Marc's own at 17:00 with Julie,
// Paul and Léa in; a closed call of Julie's Marc answered; Paul's call that picked Marc; calls of
// another Event and of yesterday.
const CALLS = [
  callRow({ id: id(1) }),
  callRow({
    id: id(2),
    poster_global_person_id: PAUL,
    spar_time: '16:00:00',
    closes_at: '2026-05-23T20:00:00+00:00',
  }),
  callRow({
    id: id(3),
    poster_global_person_id: MARC,
    spar_time: '17:00:00',
    closes_at: '2026-05-23T21:00:00+00:00',
  }),
  callRow({
    id: id(4),
    status: 'closed',
    spar_time: '13:00:00',
    closes_at: '2026-05-23T17:00:00+00:00',
  }),
  callRow({
    id: id(5),
    poster_global_person_id: PAUL,
    status: 'picked',
    picked_global_person_id: MARC,
    spar_time: '14:30:00',
    closes_at: '2026-05-23T18:30:00+00:00',
  }),
  callRow({ id: id(6), event_id: LATER_EVENT }),
  callRow({ id: id(7), spar_day: '2026-05-22' }),
];
const ANSWERS = [
  answerRow(id(1), MARC),
  answerRow(id(1), PAUL),
  answerRow(id(3), JULIE, '2026-05-23T17:10:00+00:00'),
  answerRow(id(3), PAUL, '2026-05-23T17:05:00+00:00'),
  answerRow(id(3), LEA, '2026-05-23T17:20:00+00:00'),
  answerRow(id(4), MARC),
  answerRow(id(5), MARC),
];
const read = (w: World = {}) => {
  const built = world({ calls: CALLS, answers: ANSWERS, ...w });
  return { ...built, result: built.open.read(MARC, EVENT, NOW) };
};

describe('OpenCallsService.read (Decision 8)', () => {
  it('lists my calls of today: answers on an open one, oldest first; the one I picked', async () => {
    const { result } = read();
    expect((await result).mine).toEqual([
      {
        id: id(3),
        weapons: ['Longsword'],
        time: '17:00',
        state: 'open',
        picked: null,
        answers: [fighter(PAUL, 'Paul'), fighter(JULIE, 'Julie'), fighter(LEA, 'Léa')],
      },
    ]);
  });

  it('lists the others: open calls and every call of today I answered, soonest first', async () => {
    const { result } = read();
    expect((await result).others).toEqual([
      {
        id: id(4),
        poster: fighter(JULIE, 'Julie'),
        weapons: ['Longsword'],
        time: '13:00',
        open: false,
        myAnswer: 'not_this_time',
      },
      {
        id: id(5),
        poster: fighter(PAUL, 'Paul'),
        weapons: ['Longsword'],
        time: '14:30',
        open: false,
        myAnswer: 'picked',
      },
      {
        id: id(1),
        poster: fighter(JULIE, 'Julie'),
        weapons: ['Longsword'],
        time: '15:00',
        open: true,
        myAnswer: 'in',
      },
      {
        id: id(2),
        poster: fighter(PAUL, 'Paul'),
        weapons: ['Longsword'],
        time: '16:00',
        open: true,
        myAnswer: 'none',
      },
    ]);
  });

  it('carries no count and no other answerer: Paul answered Julie’s call, his id is nowhere', async () => {
    const { others } = await read().result;
    expect(Object.keys(others[0] ?? {}).sort()).toEqual([
      'id',
      'myAnswer',
      'open',
      'poster',
      'time',
      'weapons',
    ]);
    const julies = others.filter((call) => call.poster.globalPersonId === JULIE);
    expect(JSON.stringify(julies)).not.toContain(PAUL);
  });

  it('leaves out the posters I blocked, in the query, and reads only my own blocks', async () => {
    const { result, supabase } = read({ blocks: [blockRow(MARC, JULIE), blockRow(PAUL, MARC)] });
    expect((await result).others.map((call) => call.id)).toEqual([id(5), id(2)]);
    expect(filtersFor(supabase.from, 'fightbook_blocks', 'eq')).toEqual([
      ['blocker_global_person_id', MARC],
    ]);
    expect(filtersFor(supabase.from, 'spar_open_calls', 'not')).toContainEqual([
      'poster_global_person_id',
      'in',
      `(${JULIE})`,
    ]);
  });

  it('leaves out the answerers I blocked from my call’s answers', async () => {
    const { result, supabase } = read({ blocks: [blockRow(MARC, PAUL)] });
    expect((await result).mine[0]?.answers.map((f) => f.globalPersonId)).toEqual([JULIE, LEA]);
    expect(filtersFor(supabase.from, 'spar_open_call_answers', 'not')).toEqual([
      ['answerer_global_person_id', 'in', `(${PAUL})`],
    ]);
  });

  it('leaves out a poster and an answerer who switched FightBook off', async () => {
    const profiles = [
      profile(MARC, 'Marc'),
      profile(JULIE, 'Julie', false),
      profile(PAUL, 'Paul'),
      profile(LEA, 'Léa', false),
    ];
    const { mine, others } = await read({ profiles }).result;
    expect(others.map((call) => call.id)).toEqual([id(5), id(2)]);
    expect(mine[0]?.answers.map((f) => f.globalPersonId)).toEqual([PAUL]);
  });

  it('shows the fighter I picked on my picked call, and no answers once it is not open', async () => {
    const picked = callRow({
      id: id(3),
      poster_global_person_id: MARC,
      status: 'picked',
      picked_global_person_id: PAUL,
    });
    const { mine } = await read({ calls: [picked], answers: [answerRow(id(3), PAUL)] }).result;
    expect(mine).toEqual([
      {
        id: id(3),
        weapons: ['Longsword'],
        time: '15:00',
        state: 'picked',
        picked: fighter(PAUL, 'Paul'),
        answers: [],
      },
    ]);
  });

  it('reads with its bounds, select strings and owner filters', async () => {
    const { result, supabase } = read();
    await result;
    expect(selectsFor(supabase.from, 'spar_open_calls')).toEqual([
      'id, poster_global_person_id, weapons, spar_time, status, picked_global_person_id, closes_at',
      'id, poster_global_person_id, weapons, spar_time, status, picked_global_person_id, closes_at',
      'id, poster_global_person_id, weapons, spar_time, status, picked_global_person_id, closes_at',
    ]);
    // Decision 6's numbers, written out: the constants are what is held, not what holds.
    expect([MINE_MAX, OTHERS_MAX, ANSWERS_MAX]).toEqual([20, 100, 50]);
    expect(filtersFor(supabase.from, 'spar_open_calls', 'limit')).toEqual([[20], [100]]);
    expect(filtersFor(supabase.from, 'spar_open_calls', 'order')).toEqual([
      ['created_at', { ascending: false }],
      ['closes_at', { ascending: true }],
    ]);
    expect(filtersFor(supabase.from, 'spar_open_calls', 'eq')).toEqual([
      ['poster_global_person_id', MARC],
      ['event_id', EVENT],
      ['spar_day', TODAY],
      ['event_id', EVENT],
      ['spar_day', TODAY],
      ['status', 'open'],
      ['event_id', EVENT],
      ['spar_day', TODAY],
    ]);
    expect(filtersFor(supabase.from, 'spar_open_calls', 'gt')).toEqual([
      ['closes_at', NOW.toISOString()],
    ]);
    expect(filtersFor(supabase.from, 'spar_open_calls', 'neq')).toEqual([
      ['poster_global_person_id', MARC],
    ]);
    expect(selectsFor(supabase.from, 'spar_open_call_answers')).toEqual([
      'call_id',
      'answerer_global_person_id',
    ]);
    expect(filtersFor(supabase.from, 'spar_open_call_answers', 'eq')).toEqual([
      ['answerer_global_person_id', MARC],
      ['call_id', id(3)],
    ]);
    expect(filtersFor(supabase.from, 'spar_open_call_answers', 'limit')).toEqual([[100], [50]]);
    expect(filtersFor(supabase.from, 'spar_open_call_answers', 'order')).toEqual([
      ['created_at', { ascending: false }],
      ['created_at', { ascending: true }],
    ]);
  });

  it('holds at most 100 others and 50 answers', async () => {
    const many = Array.from({ length: 120 }, (_, n) =>
      callRow({
        id: `ca000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
        poster_global_person_id: PAUL,
      }),
    );
    const answers = Array.from({ length: 60 }, (_, n) =>
      answerRow(id(3), JULIE, `2026-05-23T17:${String(n).padStart(2, '0')}:00+00:00`),
    );
    const { mine, others } = await read({ calls: [...many, CALLS[2]!], answers }).result;
    expect(others).toHaveLength(100);
    expect(mine[0]?.answers).toHaveLength(50);
  });
});

describe('OpenCallsService.read: ruling 672, a blocked fighter’s view equals anyone’s', () => {
  // Julie blocked Marc. Marc still sees her calls, may answer, and reads the same as Paul would.
  it.each<[string, World]>([
    ['her open call he answered', {}],
    [
      'her call she gave to Paul',
      { calls: [callRow({ id: id(1), status: 'picked', picked_global_person_id: PAUL })] },
    ],
    ['her call she closed', { calls: [callRow({ id: id(1), status: 'closed' })] }],
    [
      'her call past its time',
      { calls: [callRow({ id: id(1), closes_at: '2026-05-23T17:00:00+00:00' })] },
    ],
  ])('%s: the same payload with and without her block', async (_, w) => {
    const base: World = {
      calls: [
        callRow({ id: id(1) }),
        callRow({
          id: id(2),
          poster_global_person_id: JULIE,
          spar_time: '16:00:00',
          closes_at: '2026-05-23T20:00:00+00:00',
        }),
      ],
      answers: [answerRow(id(1), MARC), answerRow(id(1), PAUL)],
      ...w,
    };
    const unblocked = await world(base).open.read(MARC, EVENT, NOW);
    const blocked = await world({ ...base, blocks: [blockRow(JULIE, MARC)] }).open.read(
      MARC,
      EVENT,
      NOW,
    );
    expect(blocked).toEqual(unblocked);
    expect(blocked.others.length).toBeGreaterThan(0);
  });
});

describe('OpenCallsService.read: the Event gate', () => {
  it.each<[string, string, string[] | undefined]>([
    ['a draft Event', DRAFT_EVENT, undefined],
    ['an Event I am not on', EVENT, [JULIE, PAUL]],
  ])('refuses %s: bad_event', async (_, eventId, rosterOf) => {
    const { open } = world({ calls: CALLS, rosterOf });
    expect(await codeOf(open.read(MARC, eventId, NOW))).toEqual([400, 'bad_event']);
  });

  it('answers nothing on a day the Event does not run, and reads no call', async () => {
    const { open, supabase } = world({ calls: CALLS });
    expect(await open.read(MARC, LATER_EVENT, NOW)).toEqual({ mine: [], others: [] });
    expect(queriedTables(supabase.from)).not.toContain('spar_open_calls');
  });
});
