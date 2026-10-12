import { ConflictException } from '@nestjs/common';

/**
 * A press made before its bout was last put back in play is not applied
 * (operator, 2026-10-11 and 2026-10-12).
 *
 * A tablet with no network keeps "End match", "End round" and "Start round" in
 * its queue. Somebody with a network ends the bout, then puts it back in play
 * to correct it: the Reopen button, or the undo of the hit or the card that
 * ended it. The tablet's old press then fits the bout as it reads now, and
 * ended it again with nobody looking.
 *
 * `matches.back_in_play_at` is the server's time of that last write
 * (`backInPlayColumns`, `reopen-match-columns.ts`). The press is read on the
 * server's time too (`pressedAtServer`, by its age), never on the tablet's
 * time of day. Equal is "before", as for a reset.
 *
 * Asked for a press that is NEW to the server only: one it holds is answered
 * first. A hit or a card is not asked: a bout put back in play keeps its fight.
 *
 * A tablet's own hit or card, sent late, can be what puts the bout back in
 * play. The mark then takes that row's time, and the presses behind it in the
 * same queue were tapped after it. Two sends have two delays, so a press tapped
 * under a second after such a row can read as "before". Known, and accepted.
 *
 * Known limits, as for the reset rule: a tablet whose time of day is corrected
 * forwards between a press and its send says a press older than it is. And a
 * mark can move back: a tablet's late card (10:06) that puts a round back in
 * play overwrites the mark of a Reopen made after it (10:10).
 */
export const PRESSED_BEFORE_REOPEN = 'pressed_before_reopen';

/** The pad holds the press with Discard alone: no new send cures it. */
export const pressedBeforeReopen = () =>
  new ConflictException({
    message:
      'This was pressed before the bout was put back in play. It is not applied: check the bout.',
    code: PRESSED_BEFORE_REOPEN,
  });

/**
 * `backInPlayAt`: the column as the door read it with its bout. A read that
 * does not carry it is an error: "could not read" must not pass as "never put
 * back in play".
 */
export function assertPressedAfterBackInPlay(
  matchId: string,
  backInPlayAt: unknown,
  pressedMs: number,
): void {
  if (backInPlayAt === null) return;
  const markMs = typeof backInPlayAt === 'string' ? Date.parse(backInPlayAt) : Number.NaN;
  if (Number.isNaN(markMs)) {
    throw new Error(`Could not read when bout ${matchId} was last put back in play`);
  }
  if (pressedMs > markMs) return;
  throw pressedBeforeReopen();
}
