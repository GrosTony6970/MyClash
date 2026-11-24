import { ConflictException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { mockSupabase } from '../../common/testing/supabase-chain';
import { assertBoutTakes } from './bout-not-started';
import { BOUT_SIDE_MISSING, assertBothSides, sidesOf } from './bout-sides';

/**
 * A bout waiting for a Fighter takes no Start, hit, card or colour swap (operator, 2026-11-24).
 *
 * The final of a bracket has Anna on red. Its blue side is the winner of a semi-final that is
 * still running. Léa's pad opened the final with a blank blue name, and the server let her start
 * it and score it: "validates nothing against the slot". It is refused now, before saving, with a
 * code: the pad holds a queued entry, and a Retry sends it once both sides are known.
 */
const SIDE_MISSING = new ConflictException({
  message:
    'This bout is waiting for a Fighter. It takes no Start, hit, card or colour swap until both sides are known.',
  code: 'bout_side_missing',
});
const AFTER = '2026-11-24T10:01:00.000Z';

describe('assertBothSides', () => {
  it('passes a bout with both sides known', () => {
    expect(() => assertBothSides({ red: 'reg-anna', blue: 'reg-ben' })).not.toThrow();
  });

  it('refuses a bout with no red side, with a code', () => {
    expect(() => assertBothSides({ red: null, blue: 'reg-ben' })).toThrow(SIDE_MISSING);
    expect(BOUT_SIDE_MISSING).toBe('bout_side_missing');
  });

  it('refuses a bout with no blue side', () => {
    let thrown: unknown;
    try {
      assertBothSides({ red: 'reg-anna', blue: null });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toEqual(SIDE_MISSING);
    expect((thrown as ConflictException).getStatus()).toBe(409);
  });
});

describe('sidesOf', () => {
  it('reads each side of a row through its one key', () => {
    expect(
      sidesOf({
        red_registration_id: 'reg-anna',
        blue_registration_id: null,
        red_team_id: null,
        blue_team_id: null,
      }),
    ).toEqual({ red: 'reg-anna', blue: null });
  });

  // A team bout (slice 1b): no Registration on either side, a team on each. Both are known.
  it('a team side is a known side', () => {
    expect(
      sidesOf({
        red_registration_id: null,
        blue_registration_id: null,
        red_team_id: 't',
        blue_team_id: 'team-blue',
      }),
    ).toEqual({ red: 't', blue: 'team-blue' });
  });
});

describe('assertBoutTakes and the sides of the bout', () => {
  // The bout was never reset: the reset rule passes, and only the sides are judged.
  const db = () => mockSupabase({ match_events: { rows: [] } }).service as never;
  const running = { id: 'm1', status: 'running' };

  it('refuses a new hit for a bout with a side missing', async () => {
    await expect(
      assertBoutTakes(
        db(),
        { ...running, sides: { red: 'reg-anna', blue: null } },
        { occurredAt: AFTER },
      ),
    ).rejects.toEqual(SIDE_MISSING);
  });

  // The direct card of a Fighter late on the piste is taken before the start (ruling 286a),
  // not before both Fighters are known.
  it('refuses a direct card too, on a bout not started', async () => {
    await expect(
      assertBoutTakes(
        db(),
        { id: 'm1', status: 'scheduled', sides: { red: null, blue: 'reg-ben' } },
        { occurredAt: AFTER, directCard: 'yellow' },
      ),
    ).rejects.toEqual(SIDE_MISSING);
  });

  it('takes a bout with both sides', async () => {
    await expect(
      assertBoutTakes(
        db(),
        { ...running, sides: { red: 'reg-anna', blue: 'reg-ben' } },
        { occurredAt: AFTER },
      ),
    ).resolves.toBeUndefined();
  });

  it('refuses a bout with no side at all', async () => {
    await expect(
      assertBoutTakes(
        db(),
        { ...running, sides: { red: null, blue: null } },
        { occurredAt: AFTER },
      ),
    ).rejects.toEqual(SIDE_MISSING);
  });

  // A protest is outside the ruling: its door says so out loud, and the sides are not judged.
  it('does not judge the sides of a door that says "not-judged"', async () => {
    await expect(
      assertBoutTakes(db(), { ...running, sides: 'not-judged' }, { occurredAt: AFTER }),
    ).resolves.toBeUndefined();
  });

  // No silent opt-out: a door that names no sides is a type error, never "not judged".
  it('takes no door that forgets the sides', () => {
    const forgot = () =>
      // @ts-expect-error `sides` is required: the sides, or 'not-judged'.
      assertBoutTakes(db(), running, { occurredAt: AFTER });
    expect(typeof forgot).toBe('function');
  });
});
