'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SuggestConfig } from '@myclash/types';
import { apiRequest } from '@myclash/api-client';
import { useI18n } from '@myclash/next-i18n/client';
import { mutateSchedule, refusalText } from './schedule-mutations';
import type { TournamentOption } from './sheet-inputs';
import { keepLiveRows } from './sheet-rows';
import { createSheetSaver, type SheetSaver } from './sheet-saver';

/** How long the sheet waits after the last keystroke before it saves. */
const SHEET_SAVE_DELAY_MS = 500;

export interface ProgrammeSheet {
  /** Null until the sheet has loaded, and for good if the load failed. */
  config: SuggestConfig | null;
  /** The Event's Tournaments, for the per-Tournament rows. */
  tournaments: TournamentOption[];
  loadFailed: boolean;
  /** The last refused save, cleared by the next save that lands. */
  saveError: string | null;
  /** Take an edit: shown at once, saved after a pause in typing when `valid`. */
  edit: (next: SuggestConfig, valid: boolean) => void;
  /** Send a waiting sheet now, and wait until every save has settled. */
  flush: () => Promise<void>;
}

/**
 * The planner's sheet (ADR-018): read once per Event, saved as it changes.
 *
 * Called by the schedule page, above the grid's remount key, never by the
 * planner: the grid remounts the planner after Save, Reset and Generate and when
 * its panel collapses, and a read by each fresh mount could land before the last
 * mount's save.
 *
 * THE RACES, named. A read landing after an edit would put back the number
 * just replaced, so the sheet is read in its own effect keyed on the Event
 * alone, not on the refresh key the grid bumps after it moves a bar, and
 * StrictMode's first pass is aborted so exactly one read lands. Saves are
 * serialised by ./sheet-saver. Two organisers with the planner open are
 * last-write-wins with no realtime signal: the sheet is one person's job.
 *
 * Nothing here writes on mount. A save starts only from `edit`, which change
 * handlers call.
 */
export function useProgrammeSheet(args: {
  apiUrl: string;
  eventId: string;
  /** After each save that lands. */
  onSaved?: () => void;
}): ProgrammeSheet {
  const { apiUrl, eventId } = args;
  const { t } = useI18n();
  const { config, setConfig, tournaments, loadFailed } = useSheetLoad(apiUrl, eventId);
  const [saveError, setSaveError] = useState<string | null>(null);

  const saver = useSheetSaver(
    async (sheet) => {
      await mutateSchedule(`${apiUrl}/api/v1/events/${eventId}/programme/config`, {
        method: 'PUT',
        body: sheet,
      });
      setSaveError(null);
      args.onSaved?.();
    },
    (err) => setSaveError(refusalText(err, t, t('organizer.schedulePage.planner.sheetSaveFailed'))),
  );

  function edit(next: SuggestConfig, valid: boolean): void {
    const known = new Set(tournaments.map((tournament) => tournament.id));
    const sheet = { ...next, tournaments: keepLiveRows(next.tournaments, known) };
    setConfig(sheet);
    if (valid) saver.schedule(sheet);
  }

  return { config, tournaments, loadFailed, saveError, edit, flush: saver.flush };
}

/** The sheet and the Event's Tournaments, read together, once per Event. */
function useSheetLoad(apiUrl: string, eventId: string) {
  const [config, setConfig] = useState<SuggestConfig | null>(null);
  const [tournaments, setTournaments] = useState<TournamentOption[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const init = { signal: controller.signal };
    void Promise.all([
      apiRequest<SuggestConfig>(apiUrl, `/api/v1/events/${eventId}/programme/config`, init),
      apiRequest<TournamentOption[]>(apiUrl, `/api/v1/events/${eventId}/tournaments`, init),
    ]).then(([sheet, list]) => {
      if (controller.signal.aborted) return;
      // A sheet that did not load must not look like a fresh one: edits typed
      // over stand-in numbers would replace the Event's real sheet on save.
      if (!sheet.ok || !list.ok) return setLoadFailed(true);
      setConfig(sheet.data);
      setTournaments(list.data);
    });
    return () => controller.abort();
  }, [eventId, apiUrl]);

  return { config, setConfig, tournaments, loadFailed };
}

/**
 * One saver per mounted schedule page, built on the first edit rather than while
 * rendering. It outlives the render that built it, so it reaches `write` and
 * `onError` through a ref that every render refreshes.
 */
function useSheetSaver(
  write: (sheet: SuggestConfig) => Promise<void>,
  onError: (err: unknown) => void,
): { schedule: (sheet: SuggestConfig) => void; flush: () => Promise<void> } {
  const io = useRef({ write, onError });
  // eslint-disable-next-line react-hooks/refs -- render-time mirror: the saver outlives this render and must reach the latest closures
  io.current = { write, onError };
  const saverRef = useRef<SheetSaver<SuggestConfig> | null>(null);

  const schedule = useCallback((sheet: SuggestConfig) => {
    saverRef.current ??= createSheetSaver<SuggestConfig>({
      delayMs: SHEET_SAVE_DELAY_MS,
      write: (next) => io.current.write(next),
      onError: (err) => io.current.onError(err),
      setTimer: (fn, ms) => window.setTimeout(fn, ms),
      clearTimer: (id) => window.clearTimeout(id),
    });
    saverRef.current.schedule(sheet);
  }, []);

  // No saver yet means no edit yet, so there is nothing to send.
  const flush = useCallback(() => saverRef.current?.flush() ?? Promise.resolve(), []);

  // Unmounting sends a sheet still waiting in its window rather than dropping
  // it. With nothing waiting it sends nothing, so a mount, StrictMode's double
  // mount included, still writes nothing.
  useEffect(() => () => void saverRef.current?.flush(), []);

  return { schedule, flush };
}
