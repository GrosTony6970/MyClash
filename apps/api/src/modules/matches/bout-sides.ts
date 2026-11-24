import { ConflictException } from '@nestjs/common';
import { sideKey } from '@myclash/types/side-key';

/** The code of the refusal below. The pad says it in the reader's language. */
export const BOUT_SIDE_MISSING = 'bout_side_missing';

/** The two sides of a bout, each its one key (`sideKey`), or null while it is not known. */
export interface BoutSides {
  red: string | null;
  blue: string | null;
}

const idOf = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/**
 * The sides of a bout, from its row: each side is a Registration or a team (0282). Judged by
 * side, not by Registration, so a team bout, whose Registration ids are null, has both sides.
 */
export function sidesOf(row: Record<string, unknown>): BoutSides {
  return {
    red: sideKey(idOf(row['red_registration_id']), idOf(row['red_team_id'])),
    blue: sideKey(idOf(row['blue_registration_id']), idOf(row['blue_team_id'])),
  };
}

/**
 * A bout waiting for a Fighter takes no Start, hit, card or colour swap (operator, 2026-11-24).
 *
 * A bracket bout can sit with a side missing: a placeholder, or a bout whose other Fighter wins
 * a bout still to fight. Taken, a Start or a hit gave the bout a score against nobody. Refused
 * before anything is saved. A 409 with a code, so the pad holds a queued entry and a Retry sends
 * it again once the Fighter is placed; a 422 would be sent again on every drain.
 */
export function assertBothSides(sides: BoutSides): void {
  if (sides.red !== null && sides.blue !== null) return;
  throw new ConflictException({
    message:
      'This bout is waiting for a Fighter. It takes no Start, hit, card or colour swap until both sides are known.',
    code: BOUT_SIDE_MISSING,
  });
}
