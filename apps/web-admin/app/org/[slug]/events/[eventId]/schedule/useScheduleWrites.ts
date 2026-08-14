'use client';

import { useCallback, useRef, useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import {
  mutateAll,
  mutateSchedule,
  NETWORK_FAILURE_STATUS,
  ScheduleMutationError,
} from './schedule-mutations';

/**
 * The commit core every schedule write goes through.
 *
 * ./schedule-mutations is the transport: it throws on a non-OK response and
 * never invents prose. This is the layer above it — the one that owns whether a
 * write is in flight, turns a failure into words an operator can read, and
 * decides what happens next. Everything that changes the board calls `commit`
 * or `commitAll`; nothing calls `fetch`.
 *
 * ROLLBACK IS A REFETCH. A failed write re-reads the server rather than
 * restoring a remembered value, so no call site can put back a stale or partial
 * one. That is why this hook needs `refetch` rather than owning it: the read
 * path is a separate hook, and the rollback belongs to the write.
 *
 * `isBusy` is here too, and reads the flag through a ref. The realtime
 * subscription uses it to suppress an echo while a local write is in flight,
 * and it must be a stable identity or the debounced callback is rebuilt on
 * every render.
 */

export interface ScheduleWrites {
  /** Match id currently being written, or null. Dims that card. */
  saving: string | null;
  /** A write the server refused. Distinct from a failed read — the board is
   *  showing something the database never accepted until the refetch lands. */
  saveError: string | null;
  setSaveError: (message: string | null) => void;
  /** True while any write is in flight. Stable identity, safe in a dep array. */
  isBusy: () => boolean;
  /** PATCH one match's lice + time. Throws if the server refused. */
  saveMatchPosition: (matchId: string, liceId: string, scheduledAt: string) => Promise<void>;
  /** Turn a thrown write failure into something an operator can read. */
  describeSaveError: (err: unknown) => string;
  /** Run one write. Returns false and re-reads the server on failure. */
  commit: (run: () => Promise<unknown>) => Promise<boolean>;
  /** Same contract for a fan-out. Every call is attempted before any report. */
  commitAll: (calls: ReadonlyArray<() => Promise<unknown>>) => Promise<boolean>;
}

export function useScheduleWrites(args: {
  apiUrl: string;
  /** The board's rollback path — see the note above. */
  refetch: () => Promise<void>;
}): ScheduleWrites {
  const { apiUrl, refetch } = args;
  const { t } = useI18n();
  const [saving, setSaving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const savingRef = useRef(saving);
  // eslint-disable-next-line react-hooks/refs -- intentional render-time mirror of latest saving flag for a stable isBusy identity
  savingRef.current = saving;
  const isBusy = useCallback(() => savingRef.current !== null, []);

  const saveMatchPosition = useCallback(
    async (matchId: string, liceId: string, scheduledAt: string): Promise<void> => {
      setSaving(matchId);
      try {
        await mutateSchedule(`${apiUrl}/api/v1/matches/${matchId}/schedule`, {
          method: 'PATCH',
          body: { liceId, scheduledAt },
        });
      } finally {
        setSaving(null);
      }
    },
    [apiUrl],
  );

  const describeSaveError = useCallback(
    (err: unknown): string => {
      // `schedule-mutations` reports "no response at all" as a status of zero
      // and the browser's own message, which means nothing to an organiser.
      if (err instanceof ScheduleMutationError && err.status === NETWORK_FAILURE_STATUS) {
        return t('organizer.schedulePage.grid.saveFailedOffline');
      }
      return err instanceof Error ? err.message : String(err);
    },
    [t],
  );

  const commit = useCallback(
    async (run: () => Promise<unknown>): Promise<boolean> => {
      try {
        await run();
        setSaveError(null);
        return true;
      } catch (err) {
        setSaveError(describeSaveError(err));
        await refetch();
        return false;
      }
    },
    [describeSaveError, refetch],
  );

  const commitAll = useCallback(
    async (calls: ReadonlyArray<() => Promise<unknown>>): Promise<boolean> => {
      const { total, failures } = await mutateAll(calls);
      if (failures.length === 0) {
        setSaveError(null);
        return true;
      }
      // One failure out of one is just that failure; anything else is a partial
      // fan-out, and the operator needs the count more than the first message.
      setSaveError(
        total === 1 && failures[0]
          ? describeSaveError(failures[0])
          : t('organizer.schedulePage.grid.saveFailedPartial', {
              failed: failures.length,
              total,
            }),
      );
      await refetch();
      return false;
    },
    [describeSaveError, refetch, t],
  );

  return {
    saving,
    saveError,
    setSaveError,
    isBusy,
    saveMatchPosition,
    describeSaveError,
    commit,
    commitAll,
  };
}
