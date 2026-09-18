import { describe, expect, it } from 'vitest';
import {
  detectConflicts,
  dutyTimed,
  fightItems,
  fightWindow,
  spreadPoolConflicts,
  toTimed,
  uncheckedCount,
  type TimedItem,
} from './conflicts';
import type { PoolSpan } from './types';

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
 * span. A Swiss bout at 12:00 belongs to no Pool.
 */
const bouts = [
  { id: 'a1', poolId: 'pool-a', scheduledAt: at('10:00'), durationMinutes: 5 },
  { id: 'a2', poolId: 'pool-a', scheduledAt: at('10:25'), durationMinutes: 5 },
  { id: 'a-unknown', poolId: 'pool-a', scheduledAt: at('10:40'), durationMinutes: null },
  { id: 'b1', poolId: 'pool-b', scheduledAt: at('10:50'), durationMinutes: 5 },
  { id: 'a3', poolId: 'pool-a', scheduledAt: at('11:05'), durationMinutes: 5 },
  { id: 'swiss', poolId: null, scheduledAt: at('12:00'), durationMinutes: 5 },
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
  it('gives every bout with a window and every timed Pool span, each naming its Pool', () => {
    const items = fightItems(anna, fightKey, (m) => `bout ${m.id}`);

    expect(items.map((item) => [item.key, item.label, item.poolId, item.spanOf])).toEqual([
      ['fight-a1', 'bout a1', 'pool-a', undefined],
      ['fight-a2', 'bout a2', 'pool-a', undefined],
      ['fight-b1', 'bout b1', 'pool-b', undefined],
      ['fight-a3', 'bout a3', 'pool-a', undefined],
      ['fight-swiss', 'bout swiss', undefined, undefined],
      ['pool-pool-a', 'Pool A · Open', undefined, 'pool-a'],
      ['pool-pool-b', 'Pool B · Open', undefined, 'pool-b'],
    ]);
    expect(items.find((item) => item.key === 'pool-pool-a')).toMatchObject({
      startMs: Date.parse(at('10:00')),
      endMs: Date.parse(at('11:10')),
    });
  });

  it('reads a schedule cached before the API sent Pools, without a span and without throwing', () => {
    // The /me pages paint first from localStorage, and nothing validates that copy.
    const cached = JSON.parse(
      JSON.stringify({ matches: [{ ...bouts[0], poolId: undefined }] }),
    ) as {
      matches: typeof bouts;
    };

    expect(
      fightItems(cached, fightKey, (m) => m.id).map((item) => [item.key, item.poolId]),
    ).toEqual([['fight-a1', undefined]]);
  });
});

describe('a Pool span in detectConflicts', () => {
  const conflicts = detectConflicts([
    ...fightItems(anna, fightKey, (m) => `bout ${m.id}`),
    workshop('ws', '10:31', '10:45'),
  ]);

  it("flags a workshop that falls between the fighter's bouts against their Pool", () => {
    expect(conflicts.get('ws')).toEqual(['Pool A · Open']);
  });

  it('never flags a Pool against its own bouts', () => {
    for (const key of ['fight-a1', 'fight-a2', 'fight-a3']) expect(conflicts.has(key)).toBe(false);
  });

  it("flags another Pool's bout inside the span, and the two Pools against each other", () => {
    expect(conflicts.get('fight-b1')).toEqual(['Pool A · Open']);
    expect(conflicts.get('pool-pool-a')).toEqual(['bout b1', 'Pool B · Open', 'ws']);
    expect(conflicts.get('pool-pool-b')).toEqual(['Pool A · Open']);
  });

  it('still flags two bouts of one Pool that overlap, on two pistes', () => {
    // A Pool can run on two pistes at once; Anna in two of its bouts at 10:25 is
    // a real clash, not something her Pool's span covers.
    const twoPistes = {
      ...anna,
      matches: [
        ...bouts,
        { id: 'a-piste2', poolId: 'pool-a', scheduledAt: at('10:27'), durationMinutes: 5 },
      ],
    };

    const clashes = detectConflicts(fightItems(twoPistes, fightKey, (m) => `bout ${m.id}`));

    expect(clashes.get('fight-a2')).toEqual(['bout a-piste2']);
    expect(clashes.get('fight-a-piste2')).toEqual(['bout a2']);
  });
});

describe('spreadPoolConflicts', () => {
  it.each([
    ['the /me schedule', fightKey],
    ['the old my-schedule page', matchKey],
  ])("shows a Pool's clashes on every one of its bouts on %s", (_page, boutKey) => {
    const spread = spreadPoolConflicts(
      detectConflicts([
        ...fightItems(anna, boutKey, (m) => `bout ${m.id}`),
        workshop('ws', '10:31', '10:45'),
      ]),
      anna,
      boutKey,
    );

    const poolA = ['bout b1', 'Pool B · Open', 'ws'];
    // The middle bouts and the bout with no window of its own are in the Pool too.
    for (const id of ['a1', 'a2', 'a-unknown', 'a3']) {
      expect(spread.get(boutKey({ id }))).toEqual(poolA);
    }
    // Pool B's bout already clashed with Pool A directly: listed once.
    expect(spread.get(boutKey({ id: 'b1' }))).toEqual(['Pool A · Open']);
    expect(spread.has(boutKey({ id: 'swiss' }))).toBe(false);
  });
});
