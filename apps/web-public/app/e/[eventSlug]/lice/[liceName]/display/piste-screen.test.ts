import { describe, expect, it } from 'vitest';
import { EMPTY_BOARD, type LiceBoard } from './lice-board';
import {
  NEW_SCREEN,
  boutToJudge,
  pisteScreen,
  type PisteScreen,
  type PisteScreenEvent,
} from './piste-screen';

/**
 * The piste TV keeps a bout that is over on screen for its card's time, though
 * its piste already names the next bout (operator ruling, 2026-10-13). The
 * server's read of a piste never names a completed bout.
 */
const names = (matchId: string | null): LiceBoard => ({
  ...EMPTY_BOARD,
  liceId: 'lice-1',
  matchId,
});

const after = (...events: PisteScreenEvent[]): PisteScreen =>
  events.reduce(pisteScreen, NEW_SCREEN);

const read = (matchId: string | null): PisteScreenEvent => ({
  type: 'board',
  board: names(matchId),
});
const judged = (matchId: string, over: boolean): PisteScreenEvent => ({
  type: 'judged',
  matchId,
  over,
});
const CARD_DONE: PisteScreenEvent = { type: 'cardDone' };

describe('pisteScreen', () => {
  it('shows what the piste says when nothing is on screen', () => {
    expect(after(read('m-1'))).toMatchObject({ shown: 'm-1', hold: 'none' });
    expect(after(read(null))).toMatchObject({ shown: null, hold: 'none' });
    expect(after(read(null), read('m-1'))).toMatchObject({ shown: 'm-1', hold: 'none' });
  });

  it('keeps the bout on screen and asks about it when the piste names another', () => {
    const screen = after(read('m-1'), read('m-2'));
    expect(screen).toMatchObject({ shown: 'm-1', hold: 'asking', holds: 0 });
    expect(screen.board.matchId).toBe('m-2');
    expect(boutToJudge(screen)).toBe('m-1');
  });

  it('asks the same way when the piste names nothing', () => {
    expect(after(read('m-1'), read(null))).toMatchObject({ shown: 'm-1', hold: 'asking' });
  });

  it('asks about no bout while it shows what the piste says', () => {
    expect(boutToJudge(after(read('m-1')))).toBeNull();
  });

  it('holds a bout that is over, and counts the hold', () => {
    const screen = after(read('m-1'), read('m-2'), judged('m-1', true));
    expect(screen).toMatchObject({ shown: 'm-1', hold: 'holding', holds: 1 });
    expect(boutToJudge(screen)).toBeNull();
  });

  it('shows the piste at once when the bout is not over: it was moved, or reset', () => {
    expect(after(read('m-1'), read('m-2'), judged('m-1', false))).toMatchObject({
      shown: 'm-2',
      hold: 'none',
      holds: 0,
    });
  });

  it('keeps the newest read of the piste during a hold, and the bout on screen', () => {
    const screen = after(read('m-1'), read('m-2'), judged('m-1', true), read('m-3'));
    expect(screen).toMatchObject({ shown: 'm-1', hold: 'holding', holds: 1 });
    expect(screen.board.matchId).toBe('m-3');
  });

  it('ends the hold when the piste names the bout on screen again: it was reopened', () => {
    const screen = after(read('m-1'), read('m-2'), judged('m-1', true), read('m-1'));
    expect(screen).toMatchObject({ shown: 'm-1', hold: 'none' });
  });

  it('stops asking when the piste names the bout on screen again', () => {
    const screen = after(read('m-1'), read('m-2'), read('m-1'), judged('m-1', true));
    expect(screen).toMatchObject({ shown: 'm-1', hold: 'none', holds: 0 });
  });

  it('drops an answer about a bout that is no longer on screen', () => {
    const screen = after(read('m-1'), read('m-2'), judged('m-1', false), judged('m-1', true));
    expect(screen).toMatchObject({ shown: 'm-2', hold: 'none', holds: 0 });
  });

  it('keeps the bout when its card is done, until the piste is read again', () => {
    const held = after(read('m-1'), read('m-2'), judged('m-1', true), CARD_DONE);
    expect(held).toMatchObject({ shown: 'm-1', hold: 'leaving' });
    expect(pisteScreen(held, read('m-3'))).toMatchObject({ shown: 'm-3', hold: 'none' });
  });

  it('shows the waiting card after the last bout of the piste', () => {
    const screen = after(read('m-1'), read(null), judged('m-1', true), CARD_DONE, read(null));
    expect(screen).toMatchObject({ shown: null, hold: 'none' });
  });

  it('leaves without asking when the scoreboard counted down before the piste was read', () => {
    const screen = after(read('m-1'), CARD_DONE);
    expect(screen).toMatchObject({ shown: 'm-1', hold: 'leaving' });
    expect(pisteScreen(screen, read('m-2'))).toMatchObject({ shown: 'm-2', hold: 'none' });
  });

  it('drops a late answer once the card is done', () => {
    const screen = after(read('m-1'), read('m-2'), CARD_DONE, judged('m-1', false));
    expect(screen).toMatchObject({ shown: 'm-1', hold: 'leaving' });
  });

  it('counts each hold, so the scoreboard reads its bout again for each', () => {
    const screen = after(
      read('m-1'),
      read('m-2'),
      judged('m-1', true),
      CARD_DONE,
      read('m-2'),
      read('m-3'),
      judged('m-2', true),
    );
    expect(screen).toMatchObject({ shown: 'm-2', hold: 'holding', holds: 2 });
  });
});
