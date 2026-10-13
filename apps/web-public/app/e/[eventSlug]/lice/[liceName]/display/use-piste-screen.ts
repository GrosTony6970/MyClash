'use client';

import { useCallback, useEffect, useReducer, useRef, useState, type Dispatch } from 'react';
import { readBoutOver, readLiceBoard, type LiceBoard } from './lice-board';
import {
  HOLD_CAP_MS,
  NEW_SCREEN,
  boutToJudge,
  pisteScreen,
  type PisteScreenEvent,
} from './piste-screen';

export interface PisteScreenView {
  /** The piste's last read: the waiting card's words, and what the screen polls by. */
  board: LiceBoard;
  /** The bout on screen, or none: the waiting card. */
  shown: string | null;
  /** Changes when a hold begins: the scoreboard reads its bout again. */
  rereadSignal: number;
  lastReadFailed: boolean;
  /** Read the piste again. The one path of every trigger: mount, channel, polls. */
  refresh: () => Promise<void>;
  /** The scoreboard's countdown reached zero. */
  cardDone: () => void;
}

/** The reads of the piste: once on mount, then whenever `refresh` is called. */
function usePisteReads(eventSlug: string, liceName: string, dispatch: Dispatch<PisteScreenEvent>) {
  const [lastReadFailed, setLastReadFailed] = useState(false);

  // A failed read keeps the last good picture on screen. An answer is dropped
  // only when a LATER read has already answered: dropping every answer but the
  // last one asked would take none at all on a link slower than the poll.
  const asked = useRef(0);
  const answered = useRef(0);
  const refresh = useCallback(async () => {
    const mine = ++asked.current;
    const next = await readLiceBoard(eventSlug, liceName);
    if (mine < answered.current) return;
    answered.current = mine;
    if (next) dispatch({ type: 'board', board: next });
    setLastReadFailed(next === null);
  }, [eventSlug, liceName, dispatch]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { refresh, lastReadFailed };
}

/** The longest the screen waits to hear whether its bout is over. */
export const JUDGE_LIMIT_MS = 5_000;

/**
 * Ask whether the bout `judging` is over, and tell the screen. A read that
 * never answers (a hall's wifi) would leave the screen asking for ever, on a
 * bout its piste no longer names: past the limit the answer is "not over", and
 * the screen shows what its piste says. The read's own late answer is dropped.
 */
function useJudge(judging: string | null, dispatch: Dispatch<PisteScreenEvent>) {
  useEffect(() => {
    if (!judging) return;
    let wanted = true;
    const answer = (over: boolean) => {
      if (wanted) dispatch({ type: 'judged', matchId: judging, over });
    };
    void readBoutOver(judging).then(answer);
    const limit = window.setTimeout(() => answer(false), JUDGE_LIMIT_MS);
    return () => {
      wanted = false;
      window.clearTimeout(limit);
    };
  }, [judging, dispatch]);
}

/**
 * The piste TV's reads and its hold of a bout that is over (`pisteScreen` has
 * the rules). Three races are handled here:
 *
 * - two reads of the piste that land out of order: an answer older than one
 *   already taken is dropped;
 * - the piste's read landing before the bout's own (one request against four):
 *   the screen asks `readBoutOver` itself, it does not trust what the
 *   scoreboard holds at that moment;
 * - a bout reopened while its card is up: the piste names it again, and that
 *   read ends the hold.
 */
export function usePisteScreen(eventSlug: string, liceName: string): PisteScreenView {
  const [screen, dispatch] = useReducer(pisteScreen, NEW_SCREEN);
  const { refresh, lastReadFailed } = usePisteReads(eventSlug, liceName, dispatch);

  useJudge(boutToJudge(screen), dispatch);

  // When the card is done the screen reads its piste again, and shows what the
  // piste holds: the next bout, or the waiting card. It does not follow the
  // bout's own "next" (a bout moved to another piste took the TV with it), and
  // it loads no page (a load ends fullscreen).
  const cardDone = useCallback(() => {
    dispatch({ type: 'cardDone' });
    void refresh();
  }, [refresh]);

  const holding = screen.hold === 'holding';
  useEffect(() => {
    if (!holding) return;
    const cap = window.setTimeout(cardDone, HOLD_CAP_MS);
    return () => window.clearTimeout(cap);
  }, [holding, cardDone]);

  return {
    board: screen.board,
    shown: screen.shown,
    rereadSignal: screen.holds,
    lastReadFailed,
    refresh,
    cardDone,
  };
}
