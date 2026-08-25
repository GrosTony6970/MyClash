import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_MATCH_FORMAT_CONFIG } from '@myclash/types';
import type { MatchFormatConfig } from '@myclash/types';
import { buildBoutFlow } from './bout-flow';
import type { ExchangeRow, Penalty } from '../types/match-events';

const RED_REG = 'reg-red';
const BLUE_REG = 'reg-blue';

/** Minute `m`, second `s` into a fixed match — keeps ordering readable. */
const at = (m: number, s: number) =>
  `2027-06-21T10:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.000Z`;

let seq = 0;

/**
 * A scoring exchange. `scoreDelta` is the STRIKER's netted points and
 * `defenderDelta` the opponent's — the shape `GET /matches/:id/exchanges`
 * returns, already netted for the tournament's afterblow mode.
 */
function ex(over: Partial<ExchangeRow> = {}): ExchangeRow {
  seq += 1;
  return {
    id: `ex-${seq}`,
    sequence: seq,
    type: 'clean',
    voided: false,
    occurredAt: at(0, seq),
    clockTimeMs: seq * 10_000,
    scoringSide: 'red',
    scoreDelta: 1,
    defenderDelta: null,
    ...over,
  };
}

function card(over: Partial<Penalty> = {}): Penalty {
  seq += 1;
  return {
    id: `pen-${seq}`,
    sequence: seq,
    registration_id: RED_REG,
    card: 'yellow',
    source: 'ruleset',
    short_name: 'Card',
    reason: null,
    score_delta: -1,
    causes_match_forfeit: false,
    voided: false,
    occurred_at: at(0, seq),
    clock_time_ms: seq * 10_000,
    ...over,
  };
}

function build(
  exchanges: ExchangeRow[],
  penalties: Penalty[] = [],
  matchFormat: MatchFormatConfig = DEFAULT_MATCH_FORMAT_CONFIG,
  extra: Partial<Parameters<typeof buildBoutFlow>[0]> = {},
) {
  return buildBoutFlow({
    exchanges,
    penalties,
    redRegId: RED_REG,
    blueRegId: BLUE_REG,
    matchFormat,
    ...extra,
  });
}

/** Score after the last event — what must equal the numeral on screen. */
const final = (s: ReturnType<typeof buildBoutFlow>) => {
  const last = s.points[s.points.length - 1]!;
  return { red: last.red, blue: last.blue };
};

beforeEach(() => {
  seq = 0;
});

describe('buildBoutFlow — accumulation', () => {
  it('starts at the origin so the first exchange is a visible step', () => {
    const s = build([ex({ scoreDelta: 2 })]);
    expect(s.points[0]).toMatchObject({ number: 0, red: 0, blue: 0, kind: 'origin' });
    expect(s.points).toHaveLength(2);
  });

  it('accumulates clean hits per side', () => {
    const s = build([
      ex({ scoringSide: 'red', scoreDelta: 2 }),
      ex({ scoringSide: 'blue', scoreDelta: 1 }),
      ex({ scoringSide: 'red', scoreDelta: 1 }),
    ]);
    expect(s.points.map((p) => `${p.red}-${p.blue}`)).toEqual(['0-0', '2-0', '2-1', '3-1']);
  });

  it('treats doubles and no-exchanges as flat steps that still occupy a number', () => {
    const s = build([
      ex({ scoringSide: 'red', scoreDelta: 2 }),
      ex({ type: 'double', scoringSide: null, scoreDelta: null }),
      ex({ type: 'no_exchange', scoringSide: null, scoreDelta: null }),
    ]);
    expect(s.points.map((p) => `${p.red}-${p.blue}`)).toEqual(['0-0', '2-0', '2-0', '2-0']);
    expect(s.points.map((p) => p.number)).toEqual([0, 1, 2, 3]);
    expect(s.doubles).toBe(1);
  });

  it('skips voided rows entirely', () => {
    const s = build([
      ex({ scoringSide: 'red', scoreDelta: 2 }),
      ex({ scoringSide: 'blue', scoreDelta: 3, voided: true }),
    ]);
    expect(final(s)).toEqual({ red: 2, blue: 0 });
  });

  it('lands an afterblow in FULL mode on both fighters', () => {
    // Attacker 2, defender retaliates for 1 — both keep their points.
    const s = build([
      ex({ scoringSide: 'red', type: 'afterblow', scoreDelta: 2, defenderDelta: 1 }),
    ]);
    expect(final(s)).toEqual({ red: 2, blue: 1 });
  });

  it('lands an afterblow in DEDUCTIVE mode on the attacker only', () => {
    // The API already netted 2−1: attacker keeps 1, defender scores nothing.
    // Netting again here would wrongly give the attacker 0.
    const s = build([
      ex({ scoringSide: 'red', type: 'afterblow', scoreDelta: 1, defenderDelta: 0 }),
    ]);
    expect(final(s)).toEqual({ red: 1, blue: 0 });
  });
});

describe('buildBoutFlow — penalties', () => {
  it('applies a card to the carded fighter as its own step', () => {
    const s = build(
      [ex({ scoringSide: 'red', scoreDelta: 3 })],
      [card({ registration_id: BLUE_REG, score_delta: -1 })],
    );
    expect(s.points.map((p) => [p.red, p.blue])).toEqual([
      [0, 0],
      [3, 0],
      [3, -1],
    ]);
    expect(s.points[2]).toMatchObject({ kind: 'penalty', side: 'blue', card: 'yellow' });
  });

  it('ignores voided cards', () => {
    const s = build([ex({ scoreDelta: 2 })], [card({ score_delta: -1, voided: true })]);
    expect(final(s)).toEqual({ red: 2, blue: 0 });
  });

  it('numbers cards contiguously with exchanges, as the timeline does', () => {
    // Note the spelling split the wire shapes deliberately keep: exchange rows
    // carry camelCase `occurredAt`, penalty rows raw `occurred_at`.
    const s = build(
      [ex({ occurredAt: at(0, 5) }), ex({ occurredAt: at(0, 15) })],
      [card({ occurred_at: at(0, 10) })],
    );
    expect(s.points.map((p) => `${p.number}:${p.kind}`)).toEqual([
      '0:origin',
      '1:exchange',
      '2:penalty',
      '3:exchange',
    ]);
  });
});

describe('buildBoutFlow — match format transforms', () => {
  const reverse: MatchFormatConfig = {
    ...DEFAULT_MATCH_FORMAT_CONFIG,
    scoringDirection: 'reverse_zero_loses',
    pointCap: 5,
  };

  it('counts DOWN from the point cap in reverse_zero_loses', () => {
    // Each side's score is what the OPPONENT has taken off it.
    const s = build(
      [ex({ scoringSide: 'red', scoreDelta: 2 }), ex({ scoringSide: 'blue', scoreDelta: 1 })],
      [],
      reverse,
    );
    expect(s.points.map((p) => `${p.red}-${p.blue}`)).toEqual(['5-5', '5-3', '4-3']);
  });

  it('clamps a reverse score at zero rather than going negative', () => {
    const s = build([ex({ scoringSide: 'red', scoreDelta: 9 })], [], reverse);
    expect(final(s)).toEqual({ red: 5, blue: 0 });
  });

  it('ends 0–0 on a double-cap double loss, not on the points earned', () => {
    const s = build(
      [
        ex({ scoringSide: 'red', scoreDelta: 4 }),
        ex({ type: 'double', scoringSide: null, scoreDelta: null }),
      ],
      [],
      DEFAULT_MATCH_FORMAT_CONFIG,
      { endReason: 'max_doubles' },
    );
    expect(final(s)).toEqual({ red: 0, blue: 0 });
    expect(s.doubleLoss).toBe(true);
    // Only the closing point drops — the bout still visibly happened.
    expect(s.points[1]).toMatchObject({ red: 4, blue: 0 });
  });

  it('reports the double cap so the chart can show n/max', () => {
    expect(build([]).maxDoubles).toBe(4);
    expect(build([], [], { ...DEFAULT_MATCH_FORMAT_CONFIG, maxDoubleHits: null }).maxDoubles).toBe(
      null,
    );
  });
});

describe('buildBoutFlow — best-of rounds', () => {
  const rows = [
    ex({ scoringSide: 'red', scoreDelta: 2, round_number: 1 }),
    ex({ scoringSide: 'blue', scoreDelta: 3, round_number: 2 }),
    ex({ scoringSide: 'blue', scoreDelta: 1, round_number: 2 }),
  ];

  it('keeps only the open round when bestOf > 1', () => {
    const s = build(rows, [], DEFAULT_MATCH_FORMAT_CONFIG, { bestOf: 3, currentRound: 2 });
    expect(final(s)).toEqual({ red: 0, blue: 4 });
  });

  it('keeps every row for a single-round match, round_number unread', () => {
    const s = build(rows, [], DEFAULT_MATCH_FORMAT_CONFIG, { bestOf: 1 });
    expect(final(s)).toEqual({ red: 2, blue: 4 });
  });

  it('drops a card from a closed round, the way it drops that round’s exchanges', () => {
    // The server adds only the open round's cards to `matches.red_score`
    // (migration 0191). A chart that re-applied every round's cards would drift
    // from the numeral printed beside it.
    const s = build(
      rows,
      [card({ score_delta: -1, round_number: 1 })],
      DEFAULT_MATCH_FORMAT_CONFIG,
      {
        bestOf: 3,
        currentRound: 2,
      },
    );
    expect(final(s)).toEqual({ red: 0, blue: 4 });
  });

  it('keeps a card given in the open round', () => {
    const s = build(
      rows,
      [card({ score_delta: -1, round_number: 2 })],
      DEFAULT_MATCH_FORMAT_CONFIG,
      {
        bestOf: 3,
        currentRound: 2,
      },
    );
    expect(final(s)).toEqual({ red: -1, blue: 4 });
  });

  it('treats a null round_number as round 1', () => {
    const s = build([ex({ scoreDelta: 2, round_number: null })], [], DEFAULT_MATCH_FORMAT_CONFIG, {
      bestOf: 3,
      currentRound: 1,
    });
    expect(final(s)).toEqual({ red: 2, blue: 0 });
  });
});

describe('buildBoutFlow — x axis resolution', () => {
  it('uses time when every event carries a distinct clock reading', () => {
    expect(build([ex({ clockTimeMs: 5_000 }), ex({ clockTimeMs: 9_000 })]).xAxis).toBe('time');
  });

  it('falls back to index when any row predates clock_time_ms', () => {
    expect(build([ex({ clockTimeMs: 5_000 }), ex({ clockTimeMs: null })]).xAxis).toBe('index');
  });

  it('falls back to index when every event shares one clock reading', () => {
    // Scored with the clock stopped — a time axis would stack them all at x=0.
    expect(build([ex({ clockTimeMs: 0 }), ex({ clockTimeMs: 0 })]).xAxis).toBe('index');
  });

  it('falls back to index for an empty bout', () => {
    const s = build([]);
    expect(s.xAxis).toBe('index');
    expect(s.points).toHaveLength(1);
  });
});

describe('buildBoutFlow — summary stats', () => {
  it('counts a lead change only when the lead actually turns over', () => {
    const s = build([
      ex({ scoringSide: 'red', scoreDelta: 2 }), // 2-0 red ahead
      ex({ scoringSide: 'blue', scoreDelta: 2 }), // 2-2 level, not yet a change
      ex({ scoringSide: 'blue', scoreDelta: 1 }), // 2-3 blue ahead → change
      ex({ scoringSide: 'red', scoreDelta: 2 }), // 4-3 red ahead → change
    ]);
    expect(s.leadChanges).toBe(2);
  });

  it('finds the longest unbroken run by one side', () => {
    const s = build([
      ex({ scoringSide: 'red', scoreDelta: 2 }),
      ex({ scoringSide: 'red', scoreDelta: 1 }),
      ex({ scoringSide: 'blue', scoreDelta: 1 }),
      ex({ scoringSide: 'blue', scoreDelta: 1 }),
    ]);
    expect(s.longestRun).toEqual({ side: 'red', points: 3 });
  });

  it('breaks both runs when a full afterblow scores for both fighters', () => {
    const s = build([
      ex({ scoringSide: 'red', scoreDelta: 2 }),
      ex({ scoringSide: 'red', type: 'afterblow', scoreDelta: 1, defenderDelta: 1 }),
      ex({ scoringSide: 'red', scoreDelta: 1 }),
    ]);
    expect(s.longestRun).toEqual({ side: 'red', points: 2 });
  });

  it('reports no run for a goalless bout', () => {
    expect(build([ex({ type: 'double', scoringSide: null, scoreDelta: null })]).longestRun).toBe(
      null,
    );
  });
});

describe('buildBoutFlow — agrees with the scoreboard', () => {
  /**
   * A scripted bout with the final score worked out by hand, the way a referee
   * would read it — the same belt-and-braces check the pad e2e spec makes
   * against the server. If the accumulation ever drifts from the engine, the
   * chart's last point stops matching the numeral printed beside it, which is
   * the one failure this feature cannot ship with.
   */
  it('ends on the score a referee would read off the pad', () => {
    const s = build(
      [
        ex({ scoringSide: 'red', scoreDelta: 2 }), //  red 2
        ex({ scoringSide: 'blue', scoreDelta: 1 }), // blue 1
        ex({ type: 'double', scoringSide: null, scoreDelta: null }), // nothing
        ex({ scoringSide: 'blue', type: 'afterblow', scoreDelta: 2, defenderDelta: 1 }), // blue 3, red 3
        ex({ type: 'no_exchange', scoringSide: null, scoreDelta: null }), // nothing
        ex({ scoringSide: 'red', scoreDelta: 1 }), //  red 4
      ],
      [card({ registration_id: BLUE_REG, score_delta: -1 })], // blue 2
    );
    expect(final(s)).toEqual({ red: 4, blue: 2 });
    expect(s.doubles).toBe(1);
  });
});
