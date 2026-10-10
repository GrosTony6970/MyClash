'use client';

/**
 * The clock of the bout on screen: the server's last answer, plus the clock
 * presses this tablet still holds (`offline/pad-clock.ts`).
 *
 * THREE SOURCES, and the races between them:
 *
 *   - A read of the server's clock, at the open and after each send. With no
 *     network, the copy the tablet kept of it (`kept-bout.ts`).
 *   - The answer to a press the queue just sent: the engine tells it here
 *     BEFORE the press leaves the queue. The race is a read of the clock that
 *     left before that answer and lands after it: it holds the clock from
 *     before the press. Answers are counted, and such a read is dropped.
 *   - The tablet's queue, read again when the engine says a count changed, and
 *     at once after a press of this screen (`pressed`). A press the server
 *     answered is still listed for a moment: `sent` keeps it out of the fold.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest, failureCode } from '@myclash/api-client';
import type { ClockState } from '../components/scoreboard-clock';
import { refusalMessage } from '../lib/refusal-copy';
import { kindOf, type OutboxEntry, type RejectedEntry } from '../offline/db';
import { classifySyncFailure } from '../offline/failure-kind';
import { keepClock, keptClock } from '../offline/kept-bout';
import { getPendingForMatch } from '../offline/outbox';
import { endScoreOf, padClock, pressesOf, type EndScore } from '../offline/pad-clock';
import { heldRowsOf } from '../offline/press-queue';
import type { SyncEngine } from '../offline/sync';

type Translate = Parameters<typeof refusalMessage>[1];

const NONE_SENT: ReadonlySet<string> = new Set();
interface QueuedRows {
  presses: OutboxEntry[];
  held: RejectedEntry[];
  /** Of the last End this screen saw in the queue: kept after the End was sent. */
  endScore: EndScore | null;
}

const NO_ROWS: QueuedRows = { presses: [], held: [], endScore: null };

/** An answer of the clock's door, as far as this screen reads it. */
function isClock(answer: unknown): answer is ClockState {
  return typeof (answer as Partial<ClockState> | null)?.status === 'string';
}

/** A clock the server gave, and the bout this screen asked it for. */
interface Answered {
  matchId: string;
  clock: ClockState;
}

export interface PadClock {
  /** The clock to show, or null while none is known. */
  clock: ClockState | null;
  /** Why the clock could not be read, or why a press was not taken. */
  error: string | null;
  setError: (message: string | null) => void;
  /** Reads the server's clock again. */
  readClock: () => Promise<void>;
  /** The presses of this bout the server refused, oldest first. */
  heldPresses: RejectedEntry[];
  /** Every row of this bout the server refused, a hit and a card too: the bout waits behind them. */
  heldRows: RejectedEntry[];
  /** How many presses of this bout the tablet still holds. */
  pressesWaiting: number;
  /**
   * The score "End match" was pressed on, on this tablet: what the result
   * screen shows until the server's row says the bout is completed. Null when
   * this screen saw no End of this bout in the queue.
   */
  endScore: { red: number; blue: number } | null;
  /** This screen just wrote a press: read the queue now. */
  pressed: () => void;
}

interface PadClockArgs {
  apiUrl: string;
  matchId: string;
  refreshKey: number;
  syncEngine: Pick<SyncEngine, 'onPressSent'> | null | undefined;
  /** The engine's two counts: a change of either means the queue moved. */
  pendingCount: number;
  rejectedCount: number;
  t: Translate;
}

/**
 * The server's clock of the bout: its reads, and the answers to the presses
 * the queue sent. `sent` names those presses.
 */
function useServerClock({ apiUrl, matchId, refreshKey, syncEngine, t }: PadClockArgs) {
  const [answered, setAnswered] = useState<Answered | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<ReadonlySet<string>>(NONE_SENT);
  const pressAnswers = useRef(0);

  const readClock = useCallback(async () => {
    const before = pressAnswers.current;
    const result = await apiRequest<ClockState>(apiUrl, `/api/v1/matches/${matchId}/clock`);
    if (result.ok) {
      // A press was answered while this read was out: that answer is newer.
      if (pressAnswers.current !== before) return;
      setAnswered({ matchId, clock: result.data });
      void keepClock(matchId, result.data).catch(() => undefined);
      return;
    }
    const status = result.kind === 'aborted' || result.kind === 'network' ? 0 : result.status;
    if (classifySyncFailure(status, { code: failureCode(result) }) === 'offline') {
      // No network is no fault of the clock: the tablet's copy opens, and the
      // screen already says the bout is not confirmed.
      const kept = await keptClock(matchId).catch(() => null);
      if (kept) setAnswered((now) => (now?.matchId === matchId ? now : { matchId, clock: kept }));
      return;
    }
    const message = refusalMessage(result, t, 'scoring.clock.loadFailed');
    if (message) setError(message);
  }, [apiUrl, matchId, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- readClock() sets state only after the server or the store answers.
    void readClock();
  }, [readClock, refreshKey]);

  useEffect(() => {
    return syncEngine?.onPressSent((press, clock) => {
      if (press.matchId !== matchId) return;
      pressAnswers.current += 1;
      setSent((before) => new Set(before).add(press.clientUuid));
      if (!isClock(clock)) return;
      setAnswered({ matchId, clock });
      void keepClock(matchId, clock).catch(() => undefined);
    });
  }, [syncEngine, matchId]);

  // The clock of the bout before this one must not show for this one.
  const server = answered?.matchId === matchId ? answered.clock : null;
  return { server, sent, error, setError, readClock };
}

/** The clock presses of the bout the tablet holds that wait, and every row of it the server refused. */
function useQueuedPresses({ matchId, refreshKey, pendingCount, rejectedCount }: PadClockArgs) {
  const [rows, setRows] = useState(NO_ROWS);
  const [pressTick, setPressTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([getPendingForMatch(matchId), heldRowsOf(matchId)]).then(([queue, held]) => {
      if (cancelled) return;
      const presses = pressesOf(queue);
      setRows((before) => ({ presses, held, endScore: endScoreOf(presses, before.endScore) }));
    });
    return () => {
      cancelled = true;
    };
  }, [matchId, refreshKey, pendingCount, rejectedCount, pressTick]);

  const pressed = useCallback(() => setPressTick((tick) => tick + 1), []);
  // The rows of the bout before this one must not show for this one.
  const presses = useMemo(
    () => rows.presses.filter((row) => row.matchId === matchId),
    [rows.presses, matchId],
  );
  const held = useMemo(
    () => rows.held.filter((row) => row.matchId === matchId),
    [rows.held, matchId],
  );
  const endScore = rows.endScore?.matchId === matchId ? rows.endScore : null;
  return { presses, held, endScore, pressed };
}

export function usePadClock(args: PadClockArgs): PadClock {
  const { server, sent, error, setError, readClock } = useServerClock(args);
  const { presses, held, endScore, pressed } = useQueuedPresses(args);
  const clock = useMemo(
    () => padClock(args.matchId, server, presses, sent),
    [args.matchId, server, presses, sent],
  );

  return {
    clock,
    error,
    setError,
    readClock,
    heldPresses: held.filter((row) => kindOf(row) === 'press'),
    heldRows: held,
    pressesWaiting: presses.filter((row) => !sent.has(row.clientUuid)).length,
    endScore,
    pressed,
  };
}
