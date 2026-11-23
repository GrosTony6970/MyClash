import { describe, expect, it } from 'vitest';
import {
  detectConflicts,
  dutyTimed,
  fightItems,
  fightWindow,
  spreadBlockConflicts,
  toTimed,
  uncheckedCount,
  workshopTimed,
  type TimedItem,
} from './conflicts';
import type { PhaseSpan, PoolSpan, ScheduleMatch } from './types';

const at = (hhmm: string): string => `2027-05-22T${hhmm}:00Z`;

/** A bout as a timed commitment, labelled by its key. */
function bout(key: string, hhmm: string, durationMinutes: number | null): TimedItem {
  const window = fightWindow({ scheduledAt: at(hhmm), durationMinutes });
  if (!window) throw new Error(`bout ${key} has no window`);
  return { key, label: key, ...window };
}

function workshop(key: string, from: string, to: string): TimedItem {
  const timed = toTimed(key, key, at(from), at(to));
  if (!timed) throw new Error(`workshop ${key} has no window`);
  return timed;
}

describe('fightWindow', () => {
  it('ends a bout at its planned length', () => {
    expect(fightWindow({ scheduledAt: at('10:00'), durationMinutes: 8 })).toEqual({
      startMs: Date.parse(at('10:00')),
      endMs: Date.parse(at('10:08')),
    });
  });

  it('gives a bout whose length the API could not work out no window', () => {
    expect(fightWindow({ scheduledAt: at('10:00'), durationMinutes: null })).toBeNull();
  });

  it('gives no window, and does not throw, for a schedule cached before the API sent a length', () => {
    // The /me pages paint first from localStorage, and nothing validates that copy.
    const cached = JSON.parse(JSON.stringify({ scheduledAt: at('10:00') })) as {
      scheduledAt: string;
      durationMinutes: number | null;
    };
    expect(() => fightWindow(cached)).not.toThrow();
    expect(fightWindow(cached)).toBeNull();
  });

  it('gives no window, and does not throw, for a length that is not a positive number', () => {
    // The API cannot send one (0196's CHECK, the sheet's schema), but the cached copy
    // is not validated, and `matchWindowMs` would throw during render.
    for (const durationMinutes of [0, -5, JSON.parse('1e999') as number]) {
      expect(fightWindow({ scheduledAt: at('10:00'), durationMinutes })).toBeNull();
    }
  });

  it('gives an unplaced bout, or one whose time cannot be read, no window', () => {
    expect(fightWindow({ scheduledAt: null, durationMinutes: 5 })).toBeNull();
    expect(fightWindow({ scheduledAt: 'not a time', durationMinutes: 5 })).toBeNull();
  });

  it('ends a bout with no length at the end the API fell back on: its next bout', () => {
    expect(
      fightWindow({ scheduledAt: at('10:00'), durationMinutes: null, fallbackEndsAt: at('10:20') }),
    ).toEqual({ startMs: Date.parse(at('10:00')), endMs: Date.parse(at('10:20')) });
  });

  it('keeps the planned length over a fallback end', () => {
    // The API never sends both; a length is the answer whenever there is one.
    expect(
      fightWindow({ scheduledAt: at('10:00'), durationMinutes: 8, fallbackEndsAt: at('10:20') }),
    ).toEqual({ startMs: Date.parse(at('10:00')), endMs: Date.parse(at('10:08')) });
  });

  it('gives no window for a fallback end it cannot read, or one that is not after the start', () => {
    for (const fallbackEndsAt of [null, 'not a time', at('10:00'), at('09:50')]) {
      expect(
        fightWindow({ scheduledAt: at('10:00'), durationMinutes: null, fallbackEndsAt }),
      ).toBeNull();
    }
  });
});

describe('uncheckedCount', () => {
  it('counts the cards with a start and no window — never an unplaced card, never a Pool span', () => {
    const timed = [bout('fight-a', '10:00', 5), { ...workshop('pool-x', '10:00', '11:00') }];
    const cards = [
      { key: 'fight-a', time: at('10:00') },
      { key: 'fight-b', time: at('10:30') },
      { key: 'fight-tbd', time: null },
      { key: 'ref-1', time: at('12:00') },
    ];

    // fight-b and ref-1: placed, and the check cannot see them. The span is no card.
    expect(uncheckedCount(cards, timed)).toBe(2);
  });

  it('counts nothing when every placed card can be checked', () => {
    expect(
      uncheckedCount([{ key: 'fight-a', time: at('10:00') }], [bout('fight-a', '10:00', 5)]),
    ).toBe(0);
  });
});

describe('toTimed', () => {
  it('needs an end: a start alone has no window', () => {
    expect(toTimed('ws', 'Workshop', at('10:00'), null)).toBeNull();
    expect(toTimed('ws', 'Workshop', at('10:00'), 'not a time')).toBeNull();
    expect(toTimed('ws', 'Workshop', at('10:00'), at('11:00'))).toEqual({
      key: 'ws',
      label: 'Workshop',
      startMs: Date.parse(at('10:00')),
      endMs: Date.parse(at('11:00')),
    });
  });
});

describe('workshopTimed', () => {
  const session = { sessionStart: at('10:00'), sessionEnd: at('11:00') };

  it('is a booked session’s window', () => {
    expect(workshopTimed('ws', 'Workshop', session)?.startMs).toBe(Date.parse(at('10:00')));
    // A copy cached before the API sent the flag reads as a session that runs.
    expect(workshopTimed('ws', 'Workshop', { ...session, sessionCancelled: false })).not.toBeNull();
  });

  it('is no window for a cancelled session: it will not run, so it clashes with nothing (529)', () => {
    expect(workshopTimed('ws', 'Workshop', { ...session, sessionCancelled: true })).toBeNull();
    const fight = bout('fight', '10:30', 30);
    const cancelled = workshopTimed('ws', 'Workshop', { ...session, sessionCancelled: true });
    expect(detectConflicts([fight, ...(cancelled ? [cancelled] : [])]).size).toBe(0);
  });
});

describe('dutyTimed', () => {
  it('times a Pool duty, which has no Match time of its own, by the window the API works out', () => {
    expect(
      dutyTimed('ref-d1', 'Referee', {
        startsAt: '2027-05-22T09:00:00.000Z',
        endsAt: '2027-05-22T09:52:00.000Z',
      }),
    ).toEqual({
      key: 'ref-d1',
      label: 'Referee',
      startMs: Date.parse('2027-05-22T09:00:00.000Z'),
      endMs: Date.parse('2027-05-22T09:52:00.000Z'),
    });
  });

  it('leaves out a duty whose end the API does not know', () => {
    expect(
      dutyTimed('ref-d1', 'Referee', { startsAt: '2027-05-22T09:00:00.000Z', endsAt: null }),
    ).toBeNull();
  });
});

describe('detectConflicts', () => {
  it('flags an 8-minute bout against a Workshop that starts 6 minutes after it', () => {
    // Five guessed minutes would end the bout at 10:05, before the Workshop.
    const conflicts = detectConflicts([bout('bout', '10:00', 8), workshop('ws', '10:06', '11:00')]);
    expect(conflicts.get('bout')).toEqual(['ws']);
    expect(conflicts.get('ws')).toEqual(['bout']);
  });

  it('does not flag windows that only touch', () => {
    expect(detectConflicts([bout('bout', '10:00', 5), workshop('ws', '10:05', '11:00')]).size).toBe(
      0,
    );
  });

  it('names every clash of an item and leaves out the items clear of it', () => {
    const conflicts = detectConflicts([
      bout('a', '10:30', 5),
      bout('b', '11:55', 5),
      bout('c', '12:00', 5),
      workshop('ws', '10:00', '12:00'),
    ]);
    expect(conflicts.get('ws')).toEqual(['a', 'b']);
    expect(conflicts.get('a')).toEqual(['ws']);
    expect(conflicts.has('c')).toBe(false);
  });
});

/**
 * Anna's day. Pool A: bouts at 10:00, 10:25 and 11:05, and one whose length is
 * unknown at 10:40, all in a Pool that spans 10:00–11:10 — the middle bouts are
 * the ones a lazy rule would miss. Pool B: one bout at 10:50, inside Pool A's
 * span. A Swiss bout at 12:00 belongs to no Pool; its phase sent no span.
 *
 * Every clash names a block, never the opponent (operator, 2026-11-23).
 */
const WORDS: Record<string, string> = {
  'publicApp.me.schedule.eliminationBlock': 'Elimination',
  'publicApp.me.hub.kindSwiss': 'Swiss',
};
const t = (key: string) => WORDS[key] ?? `[${key}]`;

type Bout = Pick<
  ScheduleMatch,
  | 'id'
  | 'poolId'
  | 'scheduledAt'
  | 'durationMinutes'
  | 'fallbackEndsAt'
  | 'phase'
  | 'phaseId'
  | 'poolName'
  | 'tournamentName'
  | 'roundCode'
>;
const poolBout = (
  id: string,
  pool: 'a' | 'b',
  hhmm: string,
  durationMinutes: number | null,
): Bout => ({
  id,
  poolId: `pool-${pool}`,
  poolName: `Pool ${pool.toUpperCase()}`,
  phase: 'pool',
  phaseId: 'phase-pools',
  tournamentName: 'Open',
  roundCode: `OPN-P-${id}`,
  scheduledAt: at(hhmm),
  durationMinutes,
  fallbackEndsAt: null,
});
const bouts: Bout[] = [
  poolBout('a1', 'a', '10:00', 5),
  poolBout('a2', 'a', '10:25', 5),
  poolBout('a-unknown', 'a', '10:40', null),
  poolBout('b1', 'b', '10:50', 5),
  poolBout('a3', 'a', '11:05', 5),
  {
    ...poolBout('swiss', 'a', '12:00', 5),
    poolId: null,
    poolName: null,
    phase: 'swiss',
    phaseId: 'phase-swiss',
  },
];
const span = (poolId: string, name: string, from: string, to: string | null): PoolSpan => ({
  poolId,
  poolName: name,
  tournamentName: 'Open',
  startsAt: at(from),
  endsAt: to ? at(to) : null,
});
const anna = {
  matches: bouts,
  poolSpans: [
    span('pool-a', 'Pool A', '10:00', '11:10'),
    span('pool-b', 'Pool B', '10:50', '10:55'),
    // Its end is unknown, so it takes no part.
    span('pool-untimed', 'Pool U', '15:00', null),
  ],
};
const fightKey = (m: { id: string }) => `fight-${m.id}`;
const matchKey = (m: { id: string }) => `match-${m.id}`;

describe('fightItems', () => {
  it('gives every timed block span first, then every bout with a window, each named by its block', () => {
    const items = fightItems(anna, fightKey, t);

    expect(items.map((item) => [item.key, item.label, item.blockOf, item.spanOf])).toEqual([
      ['pool-pool-a', 'Pool A · Open', undefined, 'pool-pool-a'],
      ['pool-pool-b', 'Pool B · Open', undefined, 'pool-pool-b'],
      ['fight-a1', 'Pool A · Open', 'pool-pool-a', undefined],
      ['fight-a2', 'Pool A · Open', 'pool-pool-a', undefined],
      ['fight-b1', 'Pool B · Open', 'pool-pool-b', undefined],
      ['fight-a3', 'Pool A · Open', 'pool-pool-a', undefined],
      ['fight-swiss', 'Swiss · Open', 'phase-phase-swiss', undefined],
    ]);
    expect(items.find((item) => item.key === 'pool-pool-a')).toMatchObject({
      startMs: Date.parse(at('10:00')),
      endMs: Date.parse(at('11:10')),
    });
  });

  it('reads a schedule cached before the API sent the blocks, without a span and without throwing', () => {
    // The /me pages paint first from localStorage, and nothing validates that copy.
    const old = { ...bouts[5]!, phaseId: undefined, tournamentName: null };
    const cached = JSON.parse(
      JSON.stringify({ matches: [{ ...bouts[0], poolId: undefined }, old] }),
    ) as {
      matches: typeof bouts;
    };

    expect(
      fightItems(cached, fightKey, t).map((item) => [item.key, item.label, item.blockOf]),
    ).toEqual([
      ['fight-a1', 'Pool A · Open', undefined],
      ['fight-swiss', 'Swiss', undefined],
    ]);
  });

  it('names a bout by its code when it has no block it can name, never by the opponent', () => {
    const loose = { ...bouts[0]!, phase: null, poolId: null, poolName: null };

    expect(fightItems({ matches: [loose] }, fightKey, t).map((item) => item.label)).toEqual([
      'OPN-P-a1 · Open',
    ]);
  });
});

describe('a Pool span in detectConflicts', () => {
  const conflicts = detectConflicts([
    ...fightItems(anna, fightKey, t),
    workshop('ws', '10:31', '10:45'),
  ]);

  it("flags a workshop that falls between the fighter's bouts against their Pool", () => {
    expect(conflicts.get('ws')).toEqual(['Pool A · Open']);
  });

  it('never flags a Pool against its own bouts', () => {
    for (const key of ['fight-a1', 'fight-a2', 'fight-a3']) expect(conflicts.has(key)).toBe(false);
  });

  it("flags another Pool's bout inside the span, and the two Pools against each other, each named once", () => {
    expect(conflicts.get('fight-b1')).toEqual(['Pool A · Open']);
    // Pool B's span and its bout both meet Pool A: one name.
    expect(conflicts.get('pool-pool-a')).toEqual(['Pool B · Open', 'ws']);
    expect(conflicts.get('pool-pool-b')).toEqual(['Pool A · Open']);
  });

  it('still flags two bouts of one Pool that overlap, on two pistes', () => {
    // A Pool can run on two pistes at once; Anna in two of its bouts at 10:25 is
    // a real clash, not something her Pool's span covers.
    const twoPistes = {
      ...anna,
      matches: [...bouts, poolBout('a-piste2', 'a', '10:27', 5)],
    };

    const clashes = detectConflicts(fightItems(twoPistes, fightKey, t));

    expect(clashes.get('fight-a2')).toEqual(['Pool A · Open']);
    expect(clashes.get('fight-a-piste2')).toEqual(['Pool A · Open']);
  });
});

/**
 * Léa's bracket (operator, 2026-11-23): busy from the bracket's start, 14:00, until she is out.
 * She lost her quarter-final at 14:30, so the API ends her span at 14:40. A Workshop at 15:00 no
 * longer clashes; one at 14:05, before her own first bout, does.
 */
describe('a bracket span', () => {
  const quarter: Bout = {
    ...poolBout('qf', 'a', '14:30', 10),
    poolId: null,
    poolName: null,
    phase: 'bracket',
    phaseId: 'phase-b',
  };
  const lea = {
    matches: [quarter],
    phaseSpans: [
      {
        phaseId: 'phase-b',
        kind: 'bracket',
        tournamentName: 'Open',
        startsAt: at('14:00'),
        endsAt: at('14:40'),
      },
    ] satisfies PhaseSpan[],
  };
  const conflicts = detectConflicts([
    ...fightItems(lea, fightKey, t),
    workshop('early', '14:05', '14:20'),
    workshop('after', '15:00', '16:00'),
  ]);

  it('names the block, and holds her from its start, before her own first bout', () => {
    expect(conflicts.get('early')).toEqual(['Elimination · Open']);
  });

  it('frees her once she is out', () => {
    expect(conflicts.has('after')).toBe(false);
  });

  it('never flags the bracket against her own bout in it, and shows its clashes on that bout', () => {
    expect(conflicts.has('fight-qf')).toBe(false);
    expect(spreadBlockConflicts(conflicts, lea, fightKey).get('fight-qf')).toEqual(['early']);
  });
});

describe('spreadBlockConflicts', () => {
  it.each([
    ['the /me schedule', fightKey],
    ['the old my-schedule page', matchKey],
  ])("shows a Pool's clashes on every one of its bouts on %s", (_page, boutKey) => {
    const spread = spreadBlockConflicts(
      detectConflicts([...fightItems(anna, boutKey, t), workshop('ws', '10:31', '10:45')]),
      anna,
      boutKey,
    );

    const poolA = ['Pool B · Open', 'ws'];
    // The middle bouts and the bout with no window of its own are in the Pool too.
    for (const id of ['a1', 'a2', 'a-unknown', 'a3']) {
      expect(spread.get(boutKey({ id }))).toEqual(poolA);
    }
    // Pool B's bout already clashed with Pool A directly: listed once.
    expect(spread.get(boutKey({ id: 'b1' }))).toEqual(['Pool A · Open']);
    expect(spread.has(boutKey({ id: 'swiss' }))).toBe(false);
  });
});
