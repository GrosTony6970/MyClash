'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import { DEFAULT_EVENT_TIMEZONE } from '@myclash/time';
import { useRealtimeWithFallback } from '@/lib/supabase-browser';
import { detectConflicts, type Conflict } from './conflict-detection';
import { createRefetchGate, type RefetchGate } from './realtime-refetch-gate';
import { loadBootstrap, loadScheduleAndProgramme, type BootstrapSource } from './schedule-reads';
import type { Lice, ProgrammeBlockRow, ScheduleMatch } from './schedule-types';

/**
 * Everything the schedule board READS: the bootstrap load, the two refetchers,
 * the realtime subscription, and the conflict derivation.
 *
 * The API calls themselves are in ./schedule-reads, which knows nothing about
 * React — this file is only the state and the lifecycle. Writes are elsewhere
 * again (./schedule-mutations), which is why `refetchScheduleAndBlocks` is
 * returned rather than kept private: a failed write's rollback IS a refetch.
 *
 * CONFLICTS ARE DERIVED, not stored. They used to be `useState` recomputed by
 * hand at twelve call sites, every one of them the same two lines: set the new
 * matches, then set conflicts from that same array. Twelve chances for a new
 * mutation path to update one and forget the other. There is now one
 * derivation, and forgetting it is not expressible.
 *
 * That also retires a workaround. The bootstrap could not use `eventTz` when
 * recomputing conflicts, because its own `setEventTz` had not flushed yet, so
 * it passed a zone read straight off the response and carried a comment saying
 * why. A derivation runs at render time, after both values have landed, so the
 * special case disappears instead of moving. The rule it protected is now a
 * test in schedule-reads.test.ts, since the comment that carried it is gone.
 */

/** Coalescing window for a burst of realtime events. */
const REFETCH_DEBOUNCE_MS = 1500;

/**
 * Refresh when matches change elsewhere (scoring, another operator).
 *
 * The decision — debounce, and defer while a local write is in flight — is in
 * ./realtime-refetch-gate, which takes its timer functions as arguments and is
 * therefore the only part of this path with any test cover. This hook is the
 * lifecycle around it.
 *
 * The websocket's own 30 s poll fallback covers the unschedule-off-lice edge the
 * `lice_id` filter cannot see. It exists only while the socket is DOWN, which is
 * why the gate has to defer a suppressed refetch rather than drop it.
 */
function useScheduleRealtime(args: {
  eventId: string;
  liceIds: string[];
  refetch: () => Promise<void>;
  isBusy: () => boolean;
}): void {
  const { eventId, liceIds, refetch, isBusy } = args;
  const refetchRef = useRef(refetch);
  // eslint-disable-next-line react-hooks/refs -- intentional render-time mirror of latest refetch fn for stable debounced callback
  refetchRef.current = refetch;
  const isBusyRef = useRef(isBusy);
  // eslint-disable-next-line react-hooks/refs -- intentional render-time mirror of latest busy flag for stable debounced callback
  isBusyRef.current = isBusy;
  // Built on the first event rather than during render. The gate closes over
  // the two mirrors above, and handing a ref-reader to a function while
  // rendering is the shape `react-hooks/refs` refuses — correctly: nothing
  // guarantees the callee waits for an event before calling it.
  const gateRef = useRef<RefetchGate | null>(null);
  const scheduleRefetch = useCallback(() => {
    gateRef.current ??= createRefetchGate({
      delayMs: REFETCH_DEBOUNCE_MS,
      isBusy: () => isBusyRef.current(),
      refetch: () => void refetchRef.current(),
      setTimer: (fn, ms) => window.setTimeout(fn, ms),
      clearTimer: (id) => window.clearTimeout(id),
    });
    gateRef.current.schedule();
  }, []);
  // The pending timer used to outlive the component and fire a refetch into an
  // unmounted tree. Nothing surfaced it — the setters no-op after unmount — but
  // the request still went out.
  useEffect(() => () => gateRef.current?.cancel(), []);
  const liceIdsCsv = liceIds.join(',');
  useRealtimeWithFallback({
    channelName: `schedule-${eventId}`,
    table: 'matches',
    // Scoped to the event's lices — catches scoring/status changes + lice
    // placements. Never unfiltered: an empty set uses a sentinel that matches
    // nothing, rather than subscribing to every match in the database.
    filter: liceIdsCsv
      ? `lice_id=in.(${liceIdsCsv})`
      : 'lice_id=in.(00000000-0000-0000-0000-000000000000)',
    event: '*',
    onEvent: scheduleRefetch,
    onFallbackPoll: scheduleRefetch,
    fallbackPollMs: 30_000,
  });
}

export interface ScheduleData {
  lices: Lice[];
  matches: ScheduleMatch[];
  setMatches: React.Dispatch<React.SetStateAction<ScheduleMatch[]>>;
  days: string[];
  activeDay: string;
  setActiveDay: (day: string) => void;
  /** Event IANA timezone — the axis and every time are interpreted in it. */
  eventTz: string;
  loading: boolean;
  /** A failed READ. Distinct from a failed write: the board is empty and the
   *  operator retries, rather than showing something the server never took. */
  fetchError: string | null;
  setFetchError: (message: string | null) => void;
  programmeBlocks: ProgrammeBlockRow[];
  /** Derived from `matches` — never stored. */
  conflicts: Conflict[];
  refetchLices: () => Promise<void>;
  refetchScheduleAndBlocks: () => Promise<void>;
}

export function useScheduleData(args: {
  eventId: string;
  apiUrl: string;
  /** True while a local write is in flight — suppresses the realtime refetch. */
  isBusy: () => boolean;
}): ScheduleData {
  const { eventId, apiUrl, isBusy } = args;
  const { t } = useI18n();
  const [lices, setLices] = useState<Lice[]>([]);
  const [matches, setMatches] = useState<ScheduleMatch[]>([]);
  const [days, setDays] = useState<string[]>([]);
  const [activeDay, setActiveDay] = useState<string>('');
  const [eventTz, setEventTz] = useState<string>(DEFAULT_EVENT_TIMEZONE);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [programmeBlocks, setProgrammeBlocks] = useState<ProgrammeBlockRow[]>([]);

  // Passed into the pure conflict module, which the i18n lint rule cannot reach
  // and which must not carry English of its own.
  const unknownFighterLabel = t('organizer.schedulePage.grid.unknownFighter');
  const conflicts = useMemo(
    () => detectConflicts(matches, eventTz, unknownFighterLabel),
    [matches, eventTz, unknownFighterLabel],
  );

  const refetchLices = useCallback(async (): Promise<void> => {
    const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/lices`, {
      credentials: 'include',
    });
    if (!res.ok) return;
    const l = (await res.json()) as Lice[];
    setLices(l.sort((a, b) => a.sortOrder - b.sortOrder));
  }, [apiUrl, eventId]);

  const refetchScheduleAndBlocks = useCallback(async (): Promise<void> => {
    const result = await loadScheduleAndProgramme(apiUrl, eventId);
    // Also the rollback path after a failed write, so a silent skip would leave
    // the board showing state the server rejected — the exact failure `commit`
    // exists to prevent. A refusal has to be visible.
    if (!result.ok) {
      setFetchError(
        t('organizer.schedulePage.grid.fetchSchedule', { message: `${result.status}` }),
      );
      return;
    }
    setMatches(result.matches);
    setProgrammeBlocks(result.programmeBlocks);
  }, [apiUrl, eventId, t]);

  useEffect(() => {
    const controller = new AbortController();
    loadBootstrap(apiUrl, eventId, controller.signal)
      .then((result) => {
        setLoading(false);
        if (!result.ok) return setFetchError(bootstrapMessage(t, result.source, result.message));
        setFetchError(null);
        setLices(result.data.lices);
        setMatches(result.data.matches);
        setEventTz(result.data.timezone);
        setDays(result.data.days);
        if (result.data.days[0]) setActiveDay(result.data.days[0]);
        setProgrammeBlocks(result.data.programmeBlocks);
      })
      .catch((err: unknown) => {
        setLoading(false);
        if (err instanceof Error && err.name === 'AbortError') return;
        setFetchError(err instanceof Error ? err.message : t('admin.common.scheduleLoadFailed'));
      });
    return () => controller.abort();
  }, [eventId, apiUrl, t]);

  const liceIds = useMemo(() => lices.map((l) => l.id), [lices]);
  useScheduleRealtime({ eventId, liceIds, refetch: refetchScheduleAndBlocks, isBusy });

  return {
    lices,
    matches,
    setMatches,
    days,
    activeDay,
    setActiveDay,
    eventTz,
    loading,
    fetchError,
    setFetchError,
    programmeBlocks,
    conflicts,
    refetchLices,
    refetchScheduleAndBlocks,
  };
}

/**
 * Which endpoint refused, in the operator's language.
 *
 * A switch rather than a key map on purpose. The i18n sweep resolves keys that
 * appear as string literals at the call site; indexing a lookup table by
 * `source` would hide all four from its forward check and orphan them in its
 * reverse one.
 *
 * (Writing that call shape out as an example here is itself enough to trip the
 * sweep — it matches source text, not syntax. Hence the prose.)
 */
function bootstrapMessage(
  t: ReturnType<typeof useI18n>['t'],
  source: BootstrapSource,
  message: string,
): string {
  switch (source) {
    case 'lices':
      return t('organizer.schedulePage.grid.fetchLices', { message });
    case 'schedule':
      return t('organizer.schedulePage.grid.fetchSchedule', { message });
    case 'event':
      return t('organizer.schedulePage.grid.fetchEvent', { message });
    case 'programme':
      return t('organizer.schedulePage.grid.fetchProgramme', { message });
  }
}
