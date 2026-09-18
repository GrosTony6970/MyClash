'use client';

import { useCallback, useMemo, useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import { failureMessage } from '@myclash/api-client';
import { mutateSchedule, ScheduleMutationError } from './schedule-mutations';
import type { RunWindowBody } from './run-window';
import type { MatchPosition } from './useScheduleUndo';
import { createWriteTracker } from './write-tracker';

/**
 * The commit core every schedule write goes through.
 *
 * ./schedule-mutations is the transport: it throws on a non-OK response and
 * never invents prose. This is the layer above it — the one that owns whether a
 * write is in flight, turns a failure into words an operator can read, and
 * decides what happens next. Everything that changes the board calls `commit`;
 * nothing calls `fetch`.
 *
 * ROLLBACK IS A REFETCH. A failed write re-reads the server rather than
 * restoring a remembered value, so no call site can put back a stale or partial
 * one. That is why this hook needs `refetch` rather than owning it: the read
 * path is a separate hook, and the rollback belongs to the write.
 *
 * `isBusy` is here too, backed by ./write-tracker. The realtime subscription
 * uses it to suppress an echo while a local write is in flight, and it must be
 * a stable identity or the debounced callback is rebuilt on every render.
 *
 * It used to be `saving !== null` — the state that dims one card — so it was
 * true only during a single-fight move and false during every block move, break
 * edit, delete and group re-fan. Those are the writes with the widest cascades,
 * and they were the ones realtime was free to interrupt. Every write that goes
 * through `commit` is counted now, and `track` is exported for the two that
 * deliberately do not (they own their own error banner).
 *
 * ONE SAVE PER GESTURE. Every gesture whose bout positions the board works out
 * itself sends `savePlacements` once, with every bout it moved. (Moving a bar,
 * running late and the bracket re-fan have their own server doors.) It used to
 * send one PATCH per bout, all at once, and the server judged each against
 * bouts that had not moved yet — a
 * Pool dragged fifteen minutes later put its first bouts where its last ones
 * still sat, three PATCHes in six were refused, and the Pool was left split in
 * two.
 */

/** One bout of a batch save, where the board put it. Both null takes it off. */
export type Placement = { matchId: string } & MatchPosition;

/** These bouts taken off the board, as batch rows. */
export function unschedulePlacements(matchIds: readonly string[]): Placement[] {
  return matchIds.map((matchId) => ({ matchId, liceId: null, scheduledAt: null }));
}

export interface ScheduleWrites {
  /** The one bout a save is writing, or null. Dims that card. A save of several
   *  bouts dims none: no single card is the one being written. */
  saving: string | null;
  /** A write the server refused. Distinct from a failed read — the board is
   *  showing something the database never accepted until the refetch lands. */
  saveError: string | null;
  setSaveError: (message: string | null) => void;
  /** True while any write is in flight. Stable identity, safe in a dep array. */
  isBusy: () => boolean;
  /** Count a write that does not go through `commit` as in flight. For the two
   *  callers that own their own error banner and must keep it. */
  track: <T>(work: () => Promise<T>) => Promise<T>;
  /** POST every bout one gesture moved, as ONE batch the server checks as a
   *  whole. Throws if the server refused. `null` for both unschedules a bout —
   *  an empty string is refused, being neither a uuid nor a date. */
  savePlacements: (placements: readonly Placement[]) => Promise<void>;
  /** POST one run window's save: the run's Matches, its start and, when it changed, its
   *  bout length. The server lays the run and checks every piste as ONE batch (ADR-018).
   *  Throws if the server refused. */
  saveRunWindow: (body: RunWindowBody) => Promise<void>;
  /** Turn a thrown write failure into something an operator can read. `null`
   *  when there is nothing to say — a write this screen aborted itself. Every
   *  banner it feeds renders only when it holds a string. `fallback` is this
   *  caller's own sentence, used when the API sent no reason worth showing. */
  describeSaveError: (err: unknown, fallback?: string) => string | null;
  /** Run one write. Returns false and re-reads the server on failure. */
  commit: (run: () => Promise<unknown>) => Promise<boolean>;
}

export function useScheduleWrites(args: {
  apiUrl: string;
  eventId: string;
  /** The board's rollback path — see the note above. */
  refetch: () => Promise<void>;
}): ScheduleWrites {
  const { apiUrl, eventId, refetch } = args;
  const { t } = useI18n();
  const [saving, setSaving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const tracker = useMemo(() => createWriteTracker(), []);
  const isBusy = useCallback(() => tracker.isBusy(), [tracker]);

  const savePlacements = useCallback(
    async (placements: readonly Placement[]): Promise<void> => {
      setSaving(placements.length === 1 ? placements[0]!.matchId : null);
      try {
        await mutateSchedule(`${apiUrl}/api/v1/events/${eventId}/schedule/placements`, {
          method: 'POST',
          body: { placements },
        });
      } finally {
        setSaving(null);
      }
    },
    [apiUrl, eventId],
  );

  const saveRunWindow = useCallback(
    async (body: RunWindowBody): Promise<void> => {
      await mutateSchedule(`${apiUrl}/api/v1/events/${eventId}/schedule/run`, {
        method: 'POST',
        body,
      });
    },
    [apiUrl, eventId],
  );

  const describeSaveError = useCallback(
    (err: unknown, fallback?: string): string | null => {
      if (err instanceof ScheduleMutationError) {
        // The board keeps its own words for "no response at all". The seam's
        // network line tells the operator to check their connection; this one
        // is read under "Change not saved:", where what matters is that the
        // board is showing a placement the server never took.
        if (err.failure.kind === 'network') {
          return t('organizer.schedulePage.grid.saveFailedOffline');
        }
        // Every other refusal is the API's to explain — every field it rejected
        // rather than the first, the wait on a throttle, and the whole reason a
        // guard gave. Until now this returned `err.message`, which was the
        // server's first sentence or, when the body was unreadable, the invented
        // English status line "502 Bad Gateway".
        return failureMessage(err.failure, t, fallback);
      }
      return err instanceof Error ? err.message : String(err);
    },
    [t],
  );

  const commit = useCallback(
    async (run: () => Promise<unknown>): Promise<boolean> => {
      try {
        await tracker.track(run);
        setSaveError(null);
        return true;
      } catch (err) {
        setSaveError(describeSaveError(err));
        await refetch();
        return false;
      }
    },
    [tracker, describeSaveError, refetch],
  );

  return {
    saving,
    saveError,
    setSaveError,
    isBusy,
    track: tracker.track,
    savePlacements,
    saveRunWindow,
    describeSaveError,
    commit,
  };
}
