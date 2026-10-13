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

  // A failed read keeps the last good picture on screen.
  const lastAsked = useRef(0);
  const refresh = useCallback(async () => {
    const mine = ++lastAsked.current;
    const next = await readLiceBoard(eventSlug, liceName);
    if (mine !== lastAsked.current) return;
    if (next) dispatch({ type: 'board', board: next });
    setLastReadFailed(next === null);
  }, [eventSlug, liceName, dispatch]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { refresh, lastReadFailed };
}

/**
 * The piste TV's reads and its hold of a bout that is over (`pisteScreen` has
 * the rules). Three races are handled here:
 *
 * - two reads of the piste that land out of order: only the answer to the LAST
 *   read asked is taken;
 * - the piste's read landing before the bout's own (one request against four):
 *   the screen asks `readBoutOver` itself, it does not trust what the
 *   scoreboard holds at that moment;
 * - a bout reopened while its card is up: the piste names it again, and that
 *   read ends the hold.
 */
export function usePisteScreen(eventSlug: string, liceName: string): PisteScreenView {
  const [screen, dispatch] = useReducer(pisteScreen, NEW_SCREEN);
  const { refresh, lastReadFailed } = usePisteReads(eventSlug, liceName, dispatch);

  const judging = boutToJudge(screen);
  useEffect(() => {
    if (!judging) return;
    let wanted = true;
    void readBoutOver(judging).then((over) => {
      if (wanted) dispatch({ type: 'judged', matchId: judging, over });
    });
    return () => {
      wanted = false;
    };
  }, [judging]);

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
