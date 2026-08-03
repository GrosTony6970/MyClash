import { describe, expect, it } from 'vitest';
import {
  activeEntrants,
  buildSwissPlayers,
  validateSwissRound,
  type SwissEntrantRecord,
  type SwissMatchRecord,
  type SwissRoundRecord,
} from './swiss-snapshot';
import { DEFAULT_SWISS_POINTS } from './dto/swiss-config.dto';

const POINTS = { ...DEFAULT_SWISS_POINTS };

const entrant = (id: string, withdrawnAtRound: number | null = null): SwissEntrantRecord => ({
  registrationId: id,
  withdrawnAtRound,
});

const bout = (over: Partial<SwissMatchRecord> & { id: string }): SwissMatchRecord => ({
  redRegistrationId: null,
  blueRegistrationId: null,
  winnerRegistrationId: null,
  status: 'completed',
  endReason: null,
  ...over,
});

const round = (
  roundNumber: number,
  matches: SwissMatchRecord[],
  byeRegistrationId: string | null = null,
): SwissRoundRecord => ({
  id: `r${roundNumber}`,
  roundNumber,
  status: 'completed',
  byeRegistrationId,
  pairingMeta: null,
  matches,
});

// ── activeEntrants ───────────────────────────────────────────────────────────

describe('activeEntrants', () => {
  const field = [entrant('a'), entrant('b', 3), entrant('c', 2)];

  it('keeps everyone who has not withdrawn yet', () => {
    expect(activeEntrants(field, 2).map((e) => e.registrationId)).toEqual(['a', 'b']);
  });

  it('drops a fighter from the round they withdrew in onwards', () => {
    // c withdrew at round 2, so they are out of round 2 and every round after.
    expect(activeEntrants(field, 2).map((e) => e.registrationId)).not.toContain('c');
    expect(activeEntrants(field, 3).map((e) => e.registrationId)).toEqual(['a']);
  });

  it('keeps everyone for a round before any withdrawal', () => {
    expect(activeEntrants(field, 1)).toHaveLength(3);
  });
});

// ── buildSwissPlayers ────────────────────────────────────────────────────────

describe('buildSwissPlayers', () => {
  it('awards win/loss from the recorded winner', () => {
    const players = buildSwissPlayers(
      [entrant('a'), entrant('b')],
      [
        round(1, [
          bout({
            id: 'm1',
            redRegistrationId: 'a',
            blueRegistrationId: 'b',
            winnerRegistrationId: 'a',
          }),
        ]),
      ],
      POINTS,
    );
    expect(players.find((p) => p.registrationId === 'a')!.points).toBe(3);
    expect(players.find((p) => p.registrationId === 'b')!.points).toBe(0);
  });

  it('awards a draw when a completed bout has no winner', () => {
    const players = buildSwissPlayers(
      [entrant('a'), entrant('b')],
      [round(1, [bout({ id: 'm1', redRegistrationId: 'a', blueRegistrationId: 'b' })])],
      POINTS,
    );
    expect(players.map((p) => p.points)).toEqual([1, 1]);
  });

  it('treats a double cap as a mutual LOSS, not a draw', () => {
    // Both fighters failed to win it — the same reading the HEMA Ratings
    // export gives the same end reason.
    const players = buildSwissPlayers(
      [entrant('a'), entrant('b')],
      [
        round(1, [
          bout({
            id: 'm1',
            redRegistrationId: 'a',
            blueRegistrationId: 'b',
            endReason: 'max_doubles',
          }),
        ]),
      ],
      POINTS,
    );
    expect(players.map((p) => p.points)).toEqual([0, 0]);
  });

  it('scores a bye as a win by default and records it', () => {
    const players = buildSwissPlayers([entrant('a')], [round(1, [], 'a')], POINTS);
    expect(players[0]!.points).toBe(POINTS.bye);
    expect(players[0]!.hadBye).toBe(true);
  });

  it('honours a custom points table', () => {
    const players = buildSwissPlayers(
      [entrant('a'), entrant('b')],
      [
        round(1, [
          bout({
            id: 'm1',
            redRegistrationId: 'a',
            blueRegistrationId: 'b',
            winnerRegistrationId: 'a',
          }),
        ]),
      ],
      { win: 1, draw: 0, loss: -1, bye: 1 },
    );
    expect(players.find((p) => p.registrationId === 'a')!.points).toBe(1);
    expect(players.find((p) => p.registrationId === 'b')!.points).toBe(-1);
  });

  it('counts NO points from a bout that has not finished', () => {
    const players = buildSwissPlayers(
      [entrant('a'), entrant('b')],
      [
        round(1, [
          bout({
            id: 'm1',
            redRegistrationId: 'a',
            blueRegistrationId: 'b',
            winnerRegistrationId: 'a',
            status: 'running',
          }),
        ]),
      ],
      POINTS,
    );
    expect(players.map((p) => p.points)).toEqual([0, 0]);
  });

  it('records opponents from EVERY pairing, finished or not', () => {
    // Two fighters standing on the piste have met for rematch purposes; a
    // preview of the next round must not pair them again mid-bout.
    const players = buildSwissPlayers(
      [entrant('a'), entrant('b')],
      [
        round(1, [
          bout({
            id: 'm1',
            redRegistrationId: 'a',
            blueRegistrationId: 'b',
            status: 'scheduled',
          }),
        ]),
      ],
      POINTS,
    );
    expect(players.find((p) => p.registrationId === 'a')!.opponentIds).toEqual(['b']);
    expect(players.find((p) => p.registrationId === 'b')!.opponentIds).toEqual(['a']);
  });

  it('ranks on points descending', () => {
    const rounds = [
      round(1, [
        bout({
          id: 'm1',
          redRegistrationId: 'a',
          blueRegistrationId: 'b',
          winnerRegistrationId: 'b',
        }),
        bout({
          id: 'm2',
          redRegistrationId: 'c',
          blueRegistrationId: 'd',
          winnerRegistrationId: 'c',
        }),
      ]),
    ];
    const players = buildSwissPlayers(
      [entrant('a'), entrant('b'), entrant('c'), entrant('d')],
      rounds,
      POINTS,
    );
    expect(players.map((p) => p.registrationId)).toEqual(['b', 'c', 'a', 'd']);
    expect(players.map((p) => p.rank)).toEqual([1, 2, 3, 4]);
  });

  it('breaks a points tie on the round-1 draw order, not on id', () => {
    // The seed order is persisted precisely so a regenerated round cannot
    // reshuffle fighters who are genuinely level.
    const players = buildSwissPlayers([entrant('a'), entrant('b'), entrant('c')], [], POINTS, [
      'c',
      'a',
      'b',
    ]);
    expect(players.map((p) => p.registrationId)).toEqual(['c', 'a', 'b']);
  });

  it('falls back to id order when no seed order was recorded', () => {
    const players = buildSwissPlayers([entrant('c'), entrant('a'), entrant('b')], [], POINTS);
    expect(players.map((p) => p.registrationId)).toEqual(['a', 'b', 'c']);
  });

  it('ignores results belonging to fighters outside the field', () => {
    // A withdrawn fighter's bouts still exist; they must not resurrect them
    // into the pairing input.
    const players = buildSwissPlayers(
      [entrant('a')],
      [
        round(1, [
          bout({
            id: 'm1',
            redRegistrationId: 'a',
            blueRegistrationId: 'gone',
            winnerRegistrationId: 'a',
          }),
        ]),
      ],
      POINTS,
    );
    expect(players).toHaveLength(1);
    expect(players[0]!.opponentIds).toEqual(['gone']);
    expect(players[0]!.points).toBe(3);
  });

  it('accumulates across rounds', () => {
    const players = buildSwissPlayers(
      [entrant('a'), entrant('b')],
      [
        round(1, [
          bout({
            id: 'm1',
            redRegistrationId: 'a',
            blueRegistrationId: 'b',
            winnerRegistrationId: 'a',
          }),
        ]),
        round(2, [
          bout({
            id: 'm2',
            redRegistrationId: 'b',
            blueRegistrationId: 'a',
            winnerRegistrationId: 'a',
          }),
        ]),
      ],
      POINTS,
    );
    const a = players.find((p) => p.registrationId === 'a')!;
    expect(a.points).toBe(6);
    expect(a.opponentIds).toEqual(['b', 'b']);
  });
});

// ── validateSwissRound ───────────────────────────────────────────────────────

describe('validateSwissRound', () => {
  const pairing = (red: string | null, blue: string | null) => ({
    redRegistrationId: red,
    blueRegistrationId: blue,
  });

  it('accepts a round where everyone appears exactly once', () => {
    const result = validateSwissRound(
      ['a', 'b', 'c', 'd'],
      [pairing('a', 'b'), pairing('c', 'd')],
      null,
    );
    expect(result).toEqual({ valid: true, duplicated: [], missing: [], unknown: [] });
  });

  it('accepts an odd field closed by a bye', () => {
    expect(validateSwissRound(['a', 'b', 'c'], [pairing('a', 'b')], 'c').valid).toBe(true);
  });

  it('catches a fighter placed in two bouts', () => {
    // The exact damage set-sides can do, and the reason this exists.
    const result = validateSwissRound(
      ['a', 'b', 'c', 'd'],
      [pairing('a', 'b'), pairing('a', 'd')],
      null,
    );
    expect(result.valid).toBe(false);
    expect(result.duplicated).toEqual(['a']);
    expect(result.missing).toEqual(['c']);
  });

  it('catches a fighter both paired and holding the bye', () => {
    const result = validateSwissRound(['a', 'b', 'c'], [pairing('a', 'b')], 'a');
    expect(result.valid).toBe(false);
    expect(result.duplicated).toEqual(['a']);
    expect(result.missing).toEqual(['c']);
  });

  it('catches somebody who is not an entrant of this phase', () => {
    const result = validateSwissRound(['a', 'b'], [pairing('a', 'stranger')], null);
    expect(result.valid).toBe(false);
    expect(result.unknown).toEqual(['stranger']);
    expect(result.missing).toEqual(['b']);
  });

  it('catches an entrant left out of the round entirely', () => {
    const result = validateSwissRound(['a', 'b', 'c', 'd'], [pairing('a', 'b')], null);
    expect(result.valid).toBe(false);
    expect(result.missing).toEqual(['c', 'd']);
  });

  it('treats an empty side as absent rather than as a fighter', () => {
    const result = validateSwissRound(['a', 'b'], [pairing('a', null)], 'b');
    expect(result.valid).toBe(true);
  });

  it('reports every problem at once so one fix does not reveal the next', () => {
    const result = validateSwissRound(
      ['a', 'b', 'c'],
      [pairing('a', 'a'), pairing('stranger', 'b')],
      null,
    );
    expect(result.duplicated).toEqual(['a']);
    expect(result.unknown).toEqual(['stranger']);
    expect(result.missing).toEqual(['c']);
  });
});
