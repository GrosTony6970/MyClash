'use client';

/**
 * "Undo last entry" of the bout on screen: one undo, for every button that
 * offers it (the controls, and the round-break screen).
 *
 * The order and every fault are `undoLastEntry`'s (rulings 317, 318, 350): the
 * server is asked first, for a short time, and with no answer the undo works
 * on the tablet alone, which is what makes this work offline.
 *
 * No local count to decrement: `onUndone` bumps the refresh key on the same
 * tick and the lifted outbox read follows.
 */
import { useState } from 'react';
import { undoLastEntry, type UndoneEntry } from '../lib/clear-last';
import type { SyncEngine } from '../offline/sync';
import { takeBack } from '../offline/take-back';

type Translate = Parameters<typeof undoLastEntry>[0]['t'];

export interface UndoLast {
  /** An undo is out: a second tap does nothing. */
  busy: boolean;
  /** Why the last undo took nothing back. */
  error: string | null;
  /** The undo went for review (the Event is over): nothing was voided. */
  notice: string | null;
  /**
   * The last undo took an entry back: that entry, worded, or with no word
   * when the screen's list did not hold it. For a screen that stays up after
   * the undo (a round "End round" closed) and must say what happened.
   */
  took: { label: string | null } | null;
  undo: () => void;
}

interface UndoLastArgs {
  apiUrl: string;
  matchId: string;
  /**
   * The durable-sync engine. The undo asks it for the entry that waits on the
   * tablet: it knows which row is out, and that one is never deleted here.
   */
  syncEngine: SyncEngine | null | undefined;
  t: Translate;
  /** Reads the server's hits again. */
  refreshExchanges: () => void;
  /** Called after the undo took an entry back, or found the bout's list old. */
  onUndone: () => void;
  /**
   * Where the bout stands: its round, and whether that round is closed. What
   * an undo said is shown only while the bout stands there. Without it, "nothing
   * of this round is left to undo", said in round 2, was the first line of the
   * next round-break screen, where the undo works.
   */
  scope: string;
  /**
   * A round break is up: ONE undo per break. An undo that landed there puts
   * the round back in play, and the screen closes only when the bout is read
   * again. Until then a second tap, or Space on the focused button, would take
   * back the hit BEFORE the wrong one.
   */
  once: boolean;
  /** Words an entry as the bout's list words it, or null when the list does not hold it. */
  describe: (entry: UndoneEntry) => string | null;
}

/** What the last undo said, and where the bout stood when it said it. */
interface Said {
  scope: string;
  error?: string;
  notice?: string;
  took?: { label: string | null };
}

/**
 * What the last undo said, shown only while the bout stands where it was said.
 * The bout moved on: what was said is of a place it left. Dropped, not only
 * hidden: the same round can close a second time.
 */
function useSaid(scope: string) {
  const [said, setSaid] = useState<Said | null>(null);
  if (said && said.scope !== scope) setSaid(null);
  const here = said?.scope === scope ? said : null;
  return { here, setSaid };
}

export function useUndoLast(args: UndoLastArgs): UndoLast {
  const { apiUrl, matchId, syncEngine, t, refreshExchanges, onUndone, scope, once } = args;
  const [busy, setBusy] = useState(false);
  const { here, setSaid } = useSaid(scope);
  const [landedIn, setLandedIn] = useState<string | null>(null);
  // What landed is dropped the same way when the bout moves on.
  if (landedIn !== null && landedIn !== scope) setLandedIn(null);
  const setError = (error: string) => setSaid({ scope, error });
  const setNotice = (notice: string) => setSaid({ scope, notice });

  async function run() {
    setBusy(true);
    setSaid(null);
    try {
      const outcome = await undoLastEntry({
        apiUrl,
        matchId,
        t,
        takeBack: (entry) => (syncEngine ? syncEngine.takeBack(entry) : takeBack(entry)),
      });
      if (outcome.kind === 'failed') {
        // No message: the bout holds no entry, so this list is old. Read it again.
        if (outcome.message) setError(outcome.message);
        else onUndone();
        return;
      }
      if (outcome.kind === 'sent-for-review') {
        setNotice(t('scoring.corrections.clearLastSentForReview'));
        return;
      }
      // Worded BEFORE the lists are read again: the lists of the tap still hold the entry.
      setSaid({ scope, took: { label: args.describe(outcome.entry) } });
      setLandedIn(scope);
      refreshExchanges();
      onUndone();
    } finally {
      setBusy(false);
    }
  }

  return {
    busy,
    error: here?.error ?? null,
    notice: here?.notice ?? null,
    took: here?.took ?? null,
    undo: () => {
      if (!busy && !(once && landedIn === scope)) void run();
    },
  };
}
