import { EMPTY_BOARD, type LiceBoard } from './lice-board';

/**
 * What the piste TV has on screen, kept apart from what its piste last said.
 *
 * The server's read of a piste never names a bout that is over: when a bout
 * ends, the piste names the bout that waited, or nothing. A screen that shows
 * what the piste says at once cuts the winner's card after under a second. So a
 * bout the piste stops naming is asked about first (`asking`), and when it is
 * over it stays (`holding`) until the scoreboard's countdown is done, or the
 * screen's own cap (operator ruling, 2026-10-13).
 */
export interface PisteScreen {
  /** The piste's last read. */
  board: LiceBoard;
  /** The bout on screen, or none: the waiting card. */
  shown: string | null;
  /**
   * - `none`: the screen shows what its piste says.
   * - `asking`: the piste names another bout than the one on screen, or none;
   *   whether the bout on screen is over is being read.
   * - `holding`: it is over, and its card stays.
   * - `leaving`: the card had its time; the next read of the piste is shown.
   */
  hold: 'none' | 'asking' | 'holding' | 'leaving';
  /** How many times a hold began. The scoreboard reads its bout again when it changes. */
  holds: number;
}

export type PisteScreenEvent =
  /** A read of the piste landed. */
  | { type: 'board'; board: LiceBoard }
  /** The read of "is this bout over" landed. A read that failed says `over: false`. */
  | { type: 'judged'; matchId: string; over: boolean }
  /** The scoreboard's countdown reached zero, or the screen's cap did. */
  | { type: 'cardDone' };

export const NEW_SCREEN: PisteScreen = { board: EMPTY_BOARD, shown: null, hold: 'none', holds: 0 };

/**
 * The longest a bout the piste no longer names stays on screen. The
 * scoreboard's own countdown is five seconds and ends the hold first; the cap
 * is for a bout that counts nothing down (it names no next bout of its own).
 */
export const HOLD_CAP_MS = 8_000;

function showThePiste(screen: PisteScreen, board: LiceBoard): PisteScreen {
  return { ...screen, board, shown: board.matchId, hold: 'none' };
}

export function pisteScreen(screen: PisteScreen, event: PisteScreenEvent): PisteScreen {
  switch (event.type) {
    case 'board': {
      const { board } = event;
      const namesTheShownBout = board.matchId === screen.shown;
      if (screen.shown === null || namesTheShownBout || screen.hold === 'leaving') {
        return showThePiste(screen, board);
      }
      // The newest read is kept: it is what the screen shows when the hold ends.
      if (screen.hold === 'holding') return { ...screen, board };
      return { ...screen, board, hold: 'asking' };
    }
    case 'judged': {
      if (screen.hold !== 'asking' || event.matchId !== screen.shown) return screen;
      // Not over: the bout was moved to another piste, or put back to "not started".
      if (!event.over) return showThePiste(screen, screen.board);
      return { ...screen, hold: 'holding', holds: screen.holds + 1 };
    }
    case 'cardDone':
      return { ...screen, hold: 'leaving' };
  }
}

/** The bout whose "is it over" the screen must read now, or none. */
export function boutToJudge(screen: PisteScreen): string | null {
  return screen.hold === 'asking' ? screen.shown : null;
}
