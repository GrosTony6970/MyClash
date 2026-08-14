'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRealtimeWithFallback } from '@/lib/supabase-browser';
import { useI18n } from '@myclash/next-i18n/client';
import {
  ConfirmDialog,
  accentClassFor,
  tintBgClassFor,
  tintBorderClassFor,
  tintTextClassFor,
} from '@myclash/ui';
import { DEFAULT_EVENT_TIMEZONE, localeToBcp47 } from '@myclash/time';
import { blockTint, resolveBlockAccent } from '@myclash/types';
import { placeMultiWithShift, placeWithShift } from './place-with-shift';
import { computeHeaderRuns, type HeaderRunItem } from './compute-header-runs';
import { detectConflicts, type Conflict } from './conflict-detection';
import { POOL_HEADER_SPAN, rowShiftForSlot } from './pool-header-layout';
import { openMatchScoring } from './open-match-scoring';
import { MatchChip } from './MatchChip';
import type { GridUndo, Lice, ProgrammeBlockRow, ScheduleMatch } from './schedule-types';
import { blockDeleteAction } from './schedule-block-actions';
import { newBreakDraftFromCell } from './new-break-draft';
import { hhmmToMinutes, programmeBlocksForDay } from './programme-block-slots';
import { clampPanelWidth } from './panel-width';
import { useSchedulePrefs } from './useSchedulePrefs';
import { BlockGridView, type BgvBreak } from './BlockGridView';
import { BlockEditPopover, type BlockEditDraft } from './BlockEditPopover';
import { computeLiceDrift } from './lice-drift';
import { scheduleToCsv } from './schedule-csv';
import { respaceMatchesEvenly } from './lice-span';
import { distributeGroups } from './auto-place';
import { detectScheduleOverlaps } from './detect-overlaps';
import { detectBarCollisions } from './bar-collisions';
import { breakEditSteps } from './break-edit-steps';
import {
  LICE_HEADER_HEIGHT_PX,
  MIN_LICE_COL_PX,
  SLOT_HEIGHT_PX,
  SLOT_MINUTES,
  TIME_LABEL_COL_PX,
  VENUE_HEADER_HEIGHT_PX,
  computeVenueGroups,
  formatSlotTime,
  hhmmToSlot,
  isoToSlot,
  nowSlotForDay,
  slotToHHMM,
  slotToTime,
  snapSlot,
  venueColor,
  zoomToSlotHeight,
  parseBracketRound,
  eachDay,
  formatDayLabel,
  buildScheduleBlocks,
  type ScheduleBlock,
  type ScheduleBlockMatch,
  computeGridEndSlot,
  computeGridStartHour,
} from '@myclash/schedule-core';
import { getPublicApiUrl } from '@/lib/api-url';
import { LicePlacementEditor } from './LicePlacementEditor';
import {
  mutateAll,
  mutateSchedule,
  NETWORK_FAILURE_STATUS,
  ScheduleMutationError,
} from './schedule-mutations';

// `computeVenueGroups` + the `VenueGroup` type now live in
// ./schedule-grid-geometry (shared with BlockGridView).
//
// `Lice`, `ProgrammeBlockRow`, `GridUndo` and `ScheduleMatch` now live in
// ./schedule-types, and `openMatchScoring` in ./open-match-scoring — both read
// by the extracted children as well as by this file.

// Geometry constants + slot helpers (slotToTime / isoToSlot /
// formatSlotTime / computeVenueGroups …) live in the shared
// @myclash/schedule-core package.
//
// The axis extent is NOT a constant here any more — see `gridEndSlot`, which
// grows per day to cover the latest block. The fixed 08:00–20:00 window this
// file used to carry is now only the floor, inside `computeGridEndSlot`.

/**
 * Where "Schedule selected" starts a group on an empty lice.
 *
 * This is a wall-clock time read directly into axis space. It used to be built
 * as `${activeDay}T09:00:00` — an ISO string with NO offset, which JS parses in
 * the BROWSER's zone — and then diffed against the event-zone day start. On a
 * browser east or west of the event the two disagreed by exactly the offset, so
 * every ticked group was POSTed at the wrong hour and the server stored it
 * there: a Paris event scheduled from New York landed at 15:00, not 09:00. The
 * grid axis is already event-local, so the slot for a wall-clock time needs no
 * timezone at all.
 *
 * NOTE: the Configure planner defaults its own `dayStartTime` to 08:00, so the
 * two disagree. Left alone here — this slice is about the timezone, not the
 * default, and changing it would move where batches land.
 */
const BATCH_SCHEDULE_START_HHMM = '09:00';

// Stable empty set for the block grid's conflict/overlap tint props until S7b
// computes the real ones (avoids a new-ref churn each render).
const EMPTY_STRING_SET: Set<string> = new Set();

// `eachDay` / `formatDayLabel` live in @myclash/schedule-core (shared
// with the workshop schedule board). Imported at the top of this module.

/** True when `scheduledAtIso` falls on the same calendar day (UTC) as `dayIso`. */
function matchBelongsToDay(scheduledAtIso: string | null, dayIso: string): boolean {
  if (!scheduledAtIso) return false;
  return scheduledAtIso.slice(0, 10) === dayIso;
}

export function ScheduleGrid({
  slug,
  eventId,
  onProgrammeMutated,
  configurePanel,
}: {
  slug: string;
  eventId: string;
  /**
   * Fired after a programme-block mutation that the Configure panel
   * should refetch (block delete from the inline ×, block drag-move
   * cascade). Symmetric to ProgrammePlanner's onBlocksChanged →
   * gridRefreshKey nonce; the page bumps a `programmeRefreshKey`
   * nonce here and threads it to the planner so it re-runs its
   * mount fetch.
   */
  onProgrammeMutated?: () => void;
  /** Configure (ProgrammePlanner) rendered in the right sidebar under
   *  the Unscheduled list. Owned by the page so its generate/refresh
   *  nonces stay intact; the grid just places it. */
  configurePanel?: ReactNode;
}) {
  const { t, locale } = useI18n();
  const apiUrl = getPublicApiUrl();

  const [lices, setLices] = useState<Lice[]>([]);
  const [matches, setMatches] = useState<ScheduleMatch[]>([]);
  const [days, setDays] = useState<string[]>([]);
  const [activeDay, setActiveDay] = useState<string>('');
  // Event IANA timezone — the schedule axis + times are interpreted in it.
  const [eventTz, setEventTz] = useState<string>(DEFAULT_EVENT_TIMEZONE);
  const [loading, setLoading] = useState(true);
  // When any of the schedule-page bootstrap fetches errors out (or
  // returns a non-2xx body), surface it as a banner above the grid.
  // Before this, a 400 like the dead `tournaments.bracket_size`
  // SELECT was silently swallowed — the grid just stayed empty and
  // the operator had to dig into DevTools to find the cause.
  const [fetchError, setFetchError] = useState<string | null>(null);
  // A write that did not land. Separate from `fetchError` because the recovery
  // differs: a failed READ leaves the board empty and the operator retries, a
  // failed WRITE leaves the board showing something the server never accepted,
  // so `commit` below re-reads the truth underneath this banner.
  const [saveError, setSaveError] = useState<string | null>(null);
  // Passed into the pure conflict/CSV modules, which the i18n lint rule cannot
  // reach and which must not carry English of their own.
  const unknownFighterLabel = t('organizer.schedulePage.grid.unknownFighter');
  const [saving, setSaving] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  // Slice 7: non-fight programme blocks (registration, gear check,
  // referee meeting, breaks) rendered as full-width bars on the grid.
  const [programmeBlocks, setProgrammeBlocks] = useState<ProgrammeBlockRow[]>([]);

  /**
   * The axis ORIGIN, derived from the day's own programme rather than fixed at
   * 08:00 — the mirror of `gridEndSlot` below.
   *
   * A 07:30 gear-check block used to render at 08:00, because both converters
   * clamped anything earlier to slot 0. Dragging a neighbour then wrote that
   * wrong time back. Nothing floors such a block on the way in: the planner's
   * day-start field takes any HH:MM and the generator seeds the day from it.
   *
   * Declared here, above the two closures below, because they capture it.
   */
  const gridStartHour = useMemo(
    () => computeGridStartHour(programmeBlocks.map((b) => hhmmToMinutes(b.startTime))),
    [programmeBlocks],
  );

  // Thin closures so the many grid call sites stay 2-arg; both resolve the
  // axis in the event timezone (not the browser's) and on the derived origin.
  const slotToTimeTz = useCallback(
    (slot: number, day: string) => slotToTime(slot, day, eventTz, gridStartHour),
    [eventTz, gridStartHour],
  );
  const isoToSlotTz = useCallback(
    (iso: string, day: string) => isoToSlot(iso, day, eventTz, gridStartHour),
    [eventTz, gridStartHour],
  );
  // Slice 3 of the schedule overhaul: clear every match on the active
  // day with a confirm gate. `clearing` doubles as the modal flag and
  // the in-flight busy state for the confirm button.
  const [clearingDay, setClearingDay] = useState(false);
  const [pendingClear, setPendingClear] = useState(false);
  // Slice 4: "now" marker. Tick every 60 s so the line moves through
  // the day while the operator has the grid open. We only render the
  // line when the active day is today — past/future days don't show
  // anything (see nowSlot useMemo below).
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  // Slice 9: undo/redo stack for drag-and-drop moves. Each entry records
  // a single transition; Ctrl+Z reverses the topmost entry, Ctrl+Y or
  // Ctrl+Shift+Z replays. Stack is capped at 20 to keep memory bounded.
  // Bulk operations (Clear day, Clear pool) don't push entries — they're
  // covered by the confirm modal and aren't expected to need finger
  // memory rewinding.
  type ScheduleMove = {
    matchId: string;
    fromLiceId: string | null;
    fromScheduledAt: string | null;
    toLiceId: string | null;
    toScheduledAt: string | null;
  };
  const [undoStack, setUndoStack] = useState<ScheduleMove[]>([]);
  const [redoStack, setRedoStack] = useState<ScheduleMove[]>([]);
  const undoStackRef = useRef(undoStack);
  const redoStackRef = useRef(redoStack);
  // eslint-disable-next-line react-hooks/refs -- intentional render-time mirror of latest stacks for stable callbacks
  undoStackRef.current = undoStack;
  // eslint-disable-next-line react-hooks/refs -- intentional render-time mirror of latest stacks for stable callbacks
  redoStackRef.current = redoStack;

  // Default to the readable block view (one block per pool/round); the
  // detailed time-grid is available behind the toggle.
  const [viewMode, setViewMode] = useState<'blocks' | 'grid'>('blocks');
  // The four preferences that survive a reload (panel collapsed/width, zoom,
  // hall filter). localStorage-backed via useSyncExternalStore — see
  // ./useSchedulePrefs for why that rather than useState + a sync effect.
  const {
    panelCollapsed,
    setPanelCollapsed,
    panelWidth,
    setPanelWidth,
    slotHeightPx,
    setSlotHeightPx,
    venueFilter,
    setVenueFilter,
  } = useSchedulePrefs();
  // Tournament legend focus — clicking a chip dims the other tournaments.
  const [focusedTournament, setFocusedTournament] = useState<string | null>(null);

  // Distinct venues across this event's lices → the filter dropdown options.
  const venueFilterOptions = useMemo(() => {
    const byId = new Map<string, string>();
    let hasNoVenue = false;
    for (const l of lices) {
      if (l.venues?.id) byId.set(l.venues.id, l.venues.name);
      else hasNoVenue = true;
    }
    return { venues: [...byId].map(([id, name]) => ({ id, name })), hasNoVenue };
  }, [lices]);
  // The lices the block board renders after the per-hall filter. Blocks whose
  // lices are all hidden are skipped by BlockGridView. A stale/empty filter
  // (e.g. a venue removed from the event) falls back to showing all lices.
  const visibleLices = useMemo(() => {
    if (venueFilter === 'all') return lices;
    if (venueFilter === 'none') {
      const none = lices.filter((l) => !l.venues?.id);
      return none.length ? none : lices;
    }
    const filtered = lices.filter((l) => l.venues?.id === venueFilter);
    return filtered.length ? filtered : lices;
  }, [lices, venueFilter]);

  /**
   * The hall filter, rendered by BOTH views.
   *
   * It used to live inside the Blocks-only fragment, so switching to Detailed
   * hid the control while `venueFilter` stayed set in localStorage — the
   * operator lost the filter with no way to see or clear it, and the Detailed
   * grid ignored it anyway.
   */
  const hallFilterControl =
    venueFilterOptions.venues.length + (venueFilterOptions.hasNoVenue ? 1 : 0) > 1 ? (
      <label className="flex items-center gap-1 text-muted">
        <span className="text-[11px] font-medium">
          {t('organizer.schedulePage.grid.hallLabel')}
        </span>
        <select
          value={venueFilter}
          onChange={(e) => setVenueFilter(e.target.value)}
          className="rounded border border-border px-1.5 py-0.5 text-[11px]"
        >
          <option value="all">{t('organizer.schedulePage.grid.allHalls')}</option>
          {venueFilterOptions.venues.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
          {venueFilterOptions.hasNoVenue && (
            <option value="none">{t('organizer.schedulePage.blockGrid.noVenue')}</option>
          )}
        </select>
      </label>
    ) : null;

  function beginPanelResize(ev: React.PointerEvent<HTMLDivElement>) {
    ev.preventDefault();
    const handle = ev.currentTarget;
    handle.setPointerCapture(ev.pointerId);
    const startX = ev.clientX;
    const startW = panelWidth;
    function onMove(e: PointerEvent) {
      setPanelWidth(clampPanelWidth(startW + (e.clientX - startX)));
    }
    function cleanup(e: PointerEvent) {
      handle.releasePointerCapture(e.pointerId);
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
    }
    function onUp(e: PointerEvent) {
      cleanup(e);
    }
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  }
  // Selected (ticked) unscheduled groups for batch scheduling.
  const [tickedKeys, setTickedKeys] = useState<Set<string>>(() => new Set());
  function toggleTicked(key: string) {
    setTickedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  const [dragOverLiceId, setDragOverLiceId] = useState<string | null>(null);
  // Match ids of the block being dragged in the block view.
  const dragViewBlock = useRef<{ matchIds: string[] } | null>(null);
  // Programme bar (registration / break / referee) being dragged in the block
  // view — re-times the block (and cascades later blocks) via moveBlockTo.
  const dragViewBreak = useRef<{ id: string; startTime: string } | null>(null);

  const dragMatch = useRef<ScheduleMatch | null>(null);
  // Slice 4 of the polish pass: dropping a whole pool onto a cell.
  // Carries the pool id + the count so we can fan-out via the
  // /pools/:poolId/schedule/auto-distribute endpoint when the drop
  // lands. Mutually exclusive with `dragMatch` — onDragStart on one
  // path clears the other.
  const dragPool = useRef<{ poolId: string; matchIds: string[] } | null>(null);
  // Schedule overhaul slice 5: dragging a fixed programme block
  // (registration / break / referee meeting) on the grid moves the
  // block AND cascade-shifts every later match on the same day.
  // Mutually exclusive with dragMatch / dragPool.
  const dragBlock = useRef<{ id: string; startTime: string } | null>(null);
  // Dropping a whole bracket round (Play-ins / Round of 16 / …) onto a
  // cell, the bracket analogue of dragPool. Carries the round's match
  // ids so the drop fans them out via handleGroupDrop. Mutually
  // exclusive with dragMatch / dragPool / dragBlock.
  const dragBracketRound = useRef<{ key: string; matchIds: string[] } | null>(null);
  // Highlighted drop target while the operator drags. Drives the
  // blue ring on the hovered cell plus a HH:MM · lice-name pill so
  // the operator can aim the drop instead of guessing. Cleared on
  // drop, on cell-leave, and on drag-cancel.
  const [dragOverCell, setDragOverCell] = useState<{ liceId: string; slot: number } | null>(null);
  const [movingBlockId, setMovingBlockId] = useState<string | null>(null);
  // Block staged for deletion via the inline × button on the grid.
  // Carries the full row so the confirm modal can render the label
  // + time window in the description.
  const [pendingBlockDelete, setPendingBlockDelete] = useState<ProgrammeBlockRow | null>(null);
  const [deletingBlockId, setDeletingBlockId] = useState<string | null>(null);
  // Last reversible grid-block deletion — drives the Undo toast (auto-dismisses).
  const [lastUndo, setLastUndo] = useState<GridUndo | null>(null);
  // P8 — bottom-edge resize state. `previewSpan` is the live row-span
  // the operator is dragging toward; commits to a PATCH resize on
  // pointerup. Tracked here so the active block's render and the
  // pointer handlers can share it.
  const [resizingBlock, setResizingBlock] = useState<{
    id: string;
    startSlot: number;
    minSpan: number;
    previewSpan: number;
  } | null>(null);
  // Surfaced when auto-distribute fails so the operator sees the error
  // instead of a silent no-op.
  const [autoDistributeError, setAutoDistributeError] = useState<string | null>(null);

  // Slice C: inline "Add lice" form. Toggled by the toolbar button;
  // POSTs to /events/:id/lices then refetches the lice list so the
  // new column appears live.
  const [showAddLice, setShowAddLice] = useState(false);
  const [newLiceName, setNewLiceName] = useState('');
  const [newLiceColor, setNewLiceColor] = useState('#ef4444');
  const [addLiceBusy, setAddLiceBusy] = useState(false);
  const [addLiceError, setAddLiceError] = useState<string | null>(null);

  // The lice whose venue/area is being edited, or null. The editor is its
  // own component — grid.tsx is long enough.
  const [placingLice, setPlacingLice] = useState<Lice | null>(null);

  async function refetchLices(): Promise<void> {
    const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/lices`, {
      credentials: 'include',
    });
    if (!res.ok) return;
    const l = (await res.json()) as Lice[];
    setLices(l.sort((a, b) => a.sortOrder - b.sortOrder));
  }

  async function addLice() {
    const name = newLiceName.trim();
    if (!name) {
      setAddLiceError(t('admin.common.nameRequired'));
      return;
    }
    setAddLiceBusy(true);
    setAddLiceError(null);
    try {
      await mutateSchedule(`${apiUrl}/api/v1/events/${eventId}/lices`, {
        method: 'POST',
        body: { name, colorHex: newLiceColor, sortOrder: lices.length },
      });
      await refetchLices();
      setNewLiceName('');
      setShowAddLice(false);
    } catch (err) {
      setAddLiceError(err instanceof Error ? err.message : t('admin.common.addLiceFailed'));
    } finally {
      setAddLiceBusy(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch(`${apiUrl}/api/v1/events/${eventId}/lices`, {
        credentials: 'include',
        signal: controller.signal,
      }),
      fetch(`${apiUrl}/api/v1/events/${eventId}/schedule`, {
        credentials: 'include',
        signal: controller.signal,
      }),
      fetch(`${apiUrl}/api/v1/events/${eventId}`, {
        credentials: 'include',
        signal: controller.signal,
      }),
      fetch(`${apiUrl}/api/v1/events/${eventId}/programme`, {
        credentials: 'include',
        signal: controller.signal,
      }),
    ])
      .then(async ([licesRes, schedRes, eventRes, programmeRes]) => {
        setLoading(false);
        // Surface the first non-OK response as a banner. Each
        // endpoint reports the upstream message (NestJS exception
        // body) so the operator sees the actual DB / auth / schema
        // error instead of staring at an empty grid.
        async function bodyMessage(res: Response): Promise<string> {
          try {
            const body = (await res.json()) as { message?: string };
            return body.message ?? `${res.status} ${res.statusText}`;
          } catch {
            return `${res.status} ${res.statusText}`;
          }
        }
        if (!licesRes.ok) {
          setFetchError(
            t('organizer.schedulePage.grid.fetchLices', { message: await bodyMessage(licesRes) }),
          );
          return;
        }
        if (!schedRes.ok) {
          setFetchError(
            t('organizer.schedulePage.grid.fetchSchedule', {
              message: await bodyMessage(schedRes),
            }),
          );
          return;
        }
        if (!eventRes.ok) {
          setFetchError(
            t('organizer.schedulePage.grid.fetchEvent', { message: await bodyMessage(eventRes) }),
          );
          return;
        }
        if (!programmeRes.ok) {
          setFetchError(
            t('organizer.schedulePage.grid.fetchProgramme', {
              message: await bodyMessage(programmeRes),
            }),
          );
          return;
        }
        setFetchError(null);
        const l = (await licesRes.json()) as Lice[];
        setLices(l.sort((a, b) => a.sortOrder - b.sortOrder));
        const m = (await schedRes.json()) as ScheduleMatch[];
        setMatches(m);
        // GET /api/v1/events/:id resolves to `getEventBySlug` which returns
        // the raw Supabase row — snake_case fields. Don't paper over it
        // with `startDate` aliases unless the API mapping is unified.
        const ev = (await eventRes.json()) as {
          start_date: string;
          end_date?: string | null;
          timezone?: string | null;
        };
        // Read the zone off THIS response, not off `eventTz` state: the
        // setter below has not flushed yet, so the state still holds the
        // default and the first conflict banner would be stamped in the wrong
        // timezone until some later render recomputed it.
        const tz = ev.timezone ?? DEFAULT_EVENT_TIMEZONE;
        if (ev.timezone) setEventTz(ev.timezone);
        setConflicts(detectConflicts(m, tz, unknownFighterLabel));
        const eventDays = eachDay(ev.start_date, ev.end_date ?? null);
        setDays(eventDays);
        if (eventDays[0]) setActiveDay(eventDays[0]);
        // Slice 7: fetch every programme block; we keep the admin /
        // break entries to render as full-width bars on the grid
        // (registration, gear check, referee meeting, breaks).
        // Competition / workshop blocks are skipped — fights and
        // workshops are already rendered by the matches projection.
        const blocks = (await programmeRes.json()) as ProgrammeBlockRow[];
        setProgrammeBlocks(
          blocks.filter((b) => b.blockType === 'admin' || b.blockType === 'break'),
        );
      })
      .catch((err: unknown) => {
        setLoading(false);
        if (err instanceof Error && err.name === 'AbortError') return;
        setFetchError(err instanceof Error ? err.message : t('admin.common.scheduleLoadFailed'));
      });
    return () => controller.abort();
  }, [eventId, apiUrl, t, unknownFighterLabel]);

  /** Throws `ScheduleMutationError` if the server did not accept the position. */
  async function saveMatchPosition(matchId: string, liceId: string, scheduledAt: string) {
    setSaving(matchId);
    try {
      await mutateSchedule(`${apiUrl}/api/v1/matches/${matchId}/schedule`, {
        method: 'PATCH',
        body: { liceId, scheduledAt },
      });
    } finally {
      setSaving(null);
    }
  }

  /**
   * Turn a failed write into something an operator can read. `schedule-mutations`
   * never invents prose, so "there was no response at all" becomes words here,
   * where `t()` is in scope.
   */
  function describeSaveError(err: unknown): string {
    if (err instanceof ScheduleMutationError && err.status === NETWORK_FAILURE_STATUS) {
      return t('organizer.schedulePage.grid.saveFailedOffline');
    }
    return err instanceof Error ? err.message : String(err);
  }

  /**
   * Run one write. On failure the banner names it and the board re-reads the
   * server, discarding whatever optimistic state the caller applied.
   *
   * The rollback IS the refetch. No call site remembers a previous value, so no
   * call site can restore a stale or partial one — and it corrects the case that
   * used to be invisible, where a rejected write left the UI showing a placement
   * the database never had.
   */
  async function commit(run: () => Promise<unknown>): Promise<boolean> {
    try {
      await run();
      setSaveError(null);
      return true;
    } catch (err) {
      setSaveError(describeSaveError(err));
      await refetchScheduleAndBlocks();
      return false;
    }
  }

  /**
   * Same contract for a fan-out (a drag that displaces neighbours, a day clear).
   * Every call is attempted before anything is reported — see `mutateAll`.
   */
  async function commitAll(calls: ReadonlyArray<() => Promise<unknown>>): Promise<boolean> {
    const { total, failures } = await mutateAll(calls);
    if (failures.length === 0) {
      setSaveError(null);
      return true;
    }
    setSaveError(
      total === 1 && failures[0]
        ? describeSaveError(failures[0])
        : t('organizer.schedulePage.grid.saveFailedPartial', {
            failed: failures.length,
            total,
          }),
    );
    await refetchScheduleAndBlocks();
    return false;
  }

  async function refetchScheduleAndBlocks(): Promise<void> {
    const [schedRes, programmeRes] = await Promise.all([
      fetch(`${apiUrl}/api/v1/events/${eventId}/schedule`, { credentials: 'include' }),
      fetch(`${apiUrl}/api/v1/events/${eventId}/programme`, { credentials: 'include' }),
    ]);
    // This is also the rollback path after a failed write, so a silent skip
    // here would leave the board showing state the server rejected — the exact
    // failure `commit` exists to prevent. A refusal has to be visible.
    if (!schedRes.ok || !programmeRes.ok) {
      setFetchError(
        t('organizer.schedulePage.grid.fetchSchedule', {
          message: `${(schedRes.ok ? programmeRes : schedRes).status}`,
        }),
      );
      return;
    }
    const m = (await schedRes.json()) as ScheduleMatch[];
    setMatches(m);
    setConflicts(detectConflicts(m, eventTz, unknownFighterLabel));
    const blocks = (await programmeRes.json()) as ProgrammeBlockRow[];
    setProgrammeBlocks(blocks.filter((b) => b.blockType === 'admin' || b.blockType === 'break'));
  }

  // ── Realtime: refresh when matches change elsewhere (scoring, another
  //    operator). Debounced + suppressed during a local save so it never
  //    fights an in-flight optimistic drag. 30s poll fallback in the hook. ──
  const refetchRef = useRef(refetchScheduleAndBlocks);
  // eslint-disable-next-line react-hooks/refs -- intentional render-time mirror of latest refetch fn for stable debounced callback
  refetchRef.current = refetchScheduleAndBlocks;
  const savingRef = useRef(saving);
  // eslint-disable-next-line react-hooks/refs -- intentional render-time mirror of latest saving flag for stable debounced callback
  savingRef.current = saving;
  const refetchTimer = useRef<number | null>(null);
  const scheduleRefetch = useCallback(() => {
    if (refetchTimer.current) window.clearTimeout(refetchTimer.current);
    refetchTimer.current = window.setTimeout(() => {
      if (savingRef.current) return;
      void refetchRef.current();
    }, 1500);
  }, []);
  const liceIdsCsv = lices.map((l) => l.id).join(',');
  useRealtimeWithFallback({
    channelName: `schedule-${eventId}`,
    table: 'matches',
    // Scoped to the event's lices — catches scoring/status changes + lice
    // placements; the poll fallback covers unschedule-off-lice edges.
    filter: liceIdsCsv
      ? `lice_id=in.(${liceIdsCsv})`
      : 'lice_id=in.(00000000-0000-0000-0000-000000000000)',
    event: '*',
    onEvent: scheduleRefetch,
    onFallbackPoll: scheduleRefetch,
    fallbackPollMs: 30_000,
  });

  async function moveBlockTo(blockId: string, slot: number): Promise<void> {
    setMovingBlockId(blockId);
    try {
      // The grid axis runs 08:00–20:00 in 5-min steps. Translate the
      // drop slot back to HH:MM the backend expects.
      const newStartMin = gridStartHour * 60 + slot * SLOT_MINUTES;
      const hh = Math.floor(newStartMin / 60);
      const mm = newStartMin % 60;
      const newStartTime = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
      const ok = await commit(() =>
        mutateSchedule(`${apiUrl}/api/v1/events/${eventId}/programme/blocks/${blockId}/move`, {
          method: 'PATCH',
          body: { newStartTime },
        }),
      );
      if (!ok) return;
      // Cascade can touch many matches — refetch from source of truth
      // instead of trying to mirror the shift client-side.
      await refetchScheduleAndBlocks();
      // The block's startTime / endTime changed server-side; let the
      // Configure drawer's planner re-read its own copy so it doesn't
      // render a stale value when the operator opens it.
      onProgrammeMutated?.();
    } finally {
      setMovingBlockId(null);
    }
  }

  /**
   * Drop a programme block from the grid via the inline × affordance.
   * Backend unschedules matches whose scheduled_at falls inside the
   * block window (set scheduled_at + lice_id null → they reappear in
   * the Unscheduled sidebar); we refetch from the source of truth
   * to pick up both the new matches state and the removed block row.
   */
  /**
   * P8 — bottom-edge block resize. The handle captures the pointer
   * on mousedown, tracks vertical pointer movement in slot
   * increments (one slot = SLOT_HEIGHT_PX px), and commits on
   * pointerup. The minimum span is 1 slot (block can't be 0-length
   * or invert). Cancels via Escape — preview reverts to the stored
   * span without firing the PATCH.
   */
  function beginBlockResize(
    ev: React.PointerEvent<HTMLDivElement>,
    block: ProgrammeBlockRow & { startSlot: number; span: number },
  ): void {
    ev.preventDefault();
    ev.stopPropagation();
    const handle = ev.currentTarget;
    handle.setPointerCapture(ev.pointerId);
    const startY = ev.clientY;
    const startSpan = block.span;
    setResizingBlock({
      id: block.id,
      startSlot: block.startSlot,
      minSpan: 1,
      previewSpan: startSpan,
    });

    function onMove(e: PointerEvent) {
      const deltaSlots = Math.round((e.clientY - startY) / SLOT_HEIGHT_PX);
      const nextSpan = Math.max(1, Math.min(gridEndSlot - block.startSlot, startSpan + deltaSlots));
      setResizingBlock((prev) =>
        prev && prev.id === block.id ? { ...prev, previewSpan: nextSpan } : prev,
      );
    }
    function onUp(e: PointerEvent): void {
      void onUpAsync(e);
    }
    async function onUpAsync(e: PointerEvent) {
      handle.releasePointerCapture(e.pointerId);
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onCancel);
      // Compute new end_time from final preview span.
      const finalSpan = Math.round((e.clientY - startY) / SLOT_HEIGHT_PX) + startSpan;
      const clampedSpan = Math.max(1, Math.min(gridEndSlot - block.startSlot, finalSpan));
      setResizingBlock(null);
      if (clampedSpan === startSpan) return;
      const newEndMinutes = gridStartHour * 60 + (block.startSlot + clampedSpan) * SLOT_MINUTES;
      const hh = String(Math.floor(newEndMinutes / 60)).padStart(2, '0');
      const mm = String(newEndMinutes % 60).padStart(2, '0');
      const newEndTime = `${hh}:${mm}`;
      const ok = await commit(() =>
        mutateSchedule(`${apiUrl}/api/v1/events/${eventId}/programme/blocks/${block.id}/resize`, {
          method: 'PATCH',
          body: { newEndTime },
        }),
      );
      if (!ok) return;
      await refetchScheduleAndBlocks();
      onProgrammeMutated?.();
    }
    function onCancel(e: PointerEvent) {
      handle.releasePointerCapture(e.pointerId);
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onCancel);
      setResizingBlock(null);
    }
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onCancel);
  }

  async function deleteBlock(blockId: string): Promise<void> {
    // Snapshot the row first so Undo can re-create it (the DELETE removes it).
    const row = programmeBlocks.find((b) => b.id === blockId);
    setDeletingBlockId(blockId);
    try {
      const ok = await commit(() =>
        mutateSchedule(`${apiUrl}/api/v1/events/${eventId}/programme/blocks/${blockId}`, {
          method: 'DELETE',
        }),
      );
      if (!ok) return;
      if (row) {
        setLastUndo({
          kind: 'delete-block',
          label: row.label,
          block: {
            dayIndex: row.dayIndex,
            blockType: row.blockType,
            label: row.label,
            startTime: row.startTime,
            endTime: row.endTime,
          },
        });
      }
      await refetchScheduleAndBlocks();
      onProgrammeMutated?.();
    } finally {
      setDeletingBlockId(null);
      setPendingBlockDelete(null);
    }
  }

  /**
   * Inline × on a pool/bracket/other block: unschedule its matches (they
   * return to the Unscheduled list) and stage an Undo. No confirm dialog —
   * the Undo toast is the safety net for this one-click affordance.
   */
  function unscheduleRunBlock(block: ScheduleBlock): void {
    const action = blockDeleteAction({
      kind: block.kind,
      matchIds: block.matches.map((m) => m.id),
      blockId: block.key,
    });
    if (action.kind !== 'unschedule') return;
    const ids = new Set(action.matchIds);
    const prior = matches
      .filter((m) => ids.has(m.id))
      .map((m) => ({ id: m.id, liceId: m.liceId, scheduledAt: m.scheduledAt }));
    if (prior.length === 0) return;

    const updated = matches.map((m) =>
      ids.has(m.id) ? { ...m, liceId: null, scheduledAt: null } : m,
    );
    setMatches(updated);
    setConflicts(detectConflicts(updated, eventTz, unknownFighterLabel));
    void commitAll(action.matchIds.map((id) => () => saveMatchPosition(id, '', '')));
    setLastUndo({ kind: 'unschedule', label: block.label, matches: prior });
  }

  /** Reverse the last grid-block deletion captured in `lastUndo`. */
  async function performUndo(): Promise<void> {
    const u = lastUndo;
    if (!u) return;
    setLastUndo(null);
    if (u.kind === 'unschedule') {
      const byId = new Map(u.matches.map((m) => [m.id, m]));
      const restored = matches.map((m) => {
        const prev = byId.get(m.id);
        return prev ? { ...m, liceId: prev.liceId, scheduledAt: prev.scheduledAt } : m;
      });
      setMatches(restored);
      setConflicts(detectConflicts(restored, eventTz, unknownFighterLabel));
      await commitAll(
        u.matches.map(
          (m) => () =>
            mutateSchedule(`${apiUrl}/api/v1/matches/${m.id}/schedule`, {
              method: 'PATCH',
              body: { liceId: m.liceId, scheduledAt: m.scheduledAt },
            }),
        ),
      );
    } else {
      const ok = await commit(() =>
        mutateSchedule(`${apiUrl}/api/v1/events/${eventId}/programme/blocks`, {
          method: 'POST',
          body: u.block,
        }),
      );
      if (!ok) return;
      await refetchScheduleAndBlocks();
      onProgrammeMutated?.();
    }
  }

  // Auto-dismiss the Undo toast after a few seconds (the action already
  // persisted; the toast is only a convenience to reverse it).
  useEffect(() => {
    if (!lastUndo) return;
    const t = window.setTimeout(() => setLastUndo(null), 6000);
    return () => window.clearTimeout(t);
  }, [lastUndo]);

  function handleDrop(liceId: string, slot: number) {
    // Land on the 15-min grid (the axis still renders in 5-min slots).
    slot = snapSlot(slot);
    // Programme-block drop: the operator dragged a fixed bar. Block
    // drop takes precedence — the bar spans every lice column so any
    // cell at the target row is a valid landing.
    if (dragBlock.current) {
      const payload = dragBlock.current;
      dragBlock.current = null;
      void moveBlockTo(payload.id, slot);
      return;
    }
    // Pool-block drop takes precedence over the per-match path — same
    // cell, different payload.
    if (dragPool.current) {
      const payload = dragPool.current;
      dragPool.current = null;
      void handlePoolDrop(payload.poolId, liceId, slot);
      return;
    }
    // Bracket-round-block drop — same precedence as a pool block.
    if (dragBracketRound.current) {
      const payload = dragBracketRound.current;
      dragBracketRound.current = null;
      void handleGroupDrop(new Set(payload.matchIds), liceId, slot);
      return;
    }
    const match = dragMatch.current;
    if (!match || !activeDay) return;
    const newScheduledAt = slotToTimeTz(slot, activeDay);
    // Same-cell drop = no-op; don't pollute the undo stack.
    if (match.liceId === liceId && match.scheduledAt === newScheduledAt) {
      dragMatch.current = null;
      return;
    }
    pushUndo({
      matchId: match.id,
      fromLiceId: match.liceId,
      fromScheduledAt: match.scheduledAt,
      toLiceId: liceId,
      toScheduledAt: newScheduledAt,
    });

    // Build a placeable representation of every match currently on the
    // target lice on the active day (excluding the one being dropped if
    // it was already there). placeWithShift cascades downward, with an
    // upward fallback when the drop is too close to the grid end.
    const span = Math.max(1, Math.floor(match.durationMinutes / SLOT_MINUTES));
    const occupants = matches
      .filter(
        (m) =>
          m.id !== match.id &&
          m.liceId === liceId &&
          m.scheduledAt &&
          matchBelongsToDay(m.scheduledAt, activeDay),
      )
      .map((m) => ({
        id: m.id,
        slot: isoToSlotTz(m.scheduledAt!, activeDay),
        span: Math.max(1, Math.floor(m.durationMinutes / SLOT_MINUTES)),
      }));
    const placement = placeWithShift({
      items: occupants,
      dropped: { id: match.id, slot, span },
      dropSlot: slot,
      gridEndSlot,
    });
    const shiftedById = new Map(placement.shifted.map((s) => [s.id, s.slot]));
    const updated = matches.map((m) => {
      if (m.id === match.id) return { ...m, liceId, scheduledAt: newScheduledAt };
      const newSlot = shiftedById.get(m.id);
      if (newSlot == null) return m;
      return { ...m, scheduledAt: slotToTimeTz(newSlot, activeDay) };
    });
    setMatches(updated);
    setConflicts(detectConflicts(updated, eventTz, unknownFighterLabel));
    // The dropped match and every neighbour the shift displaced are ONE
    // operation to the operator, so they are reported as one: any rejection
    // re-reads the server instead of leaving half the column moved on screen
    // and unmoved in the database.
    const writes: Array<() => Promise<unknown>> = [
      () => saveMatchPosition(match.id, liceId, newScheduledAt),
    ];
    for (const s of placement.shifted) {
      const moved = matches.find((m) => m.id === s.id);
      if (!moved) continue;
      writes.push(() => saveMatchPosition(s.id, liceId, slotToTimeTz(s.slot, activeDay)));
    }
    void commitAll(writes);
    dragMatch.current = null;
  }

  /**
   * Group drop: place every match in `groupMatchIds` sequentially on
   * the target lice starting at `slot`, displacing any existing
   * occupants past the group's tail via placeMultiWithShift. Shared
   * by the pool block and the bracket-round block.
   *
   * Pre-P? the pool path fanned the pool across every lice via the
   * BE's /auto-distribute endpoint, which (a) scattered the group the
   * operator just dragged as a single unit and (b) silently no-op'd
   * on occupied targets. We now layout client-side on a single lice
   * and PATCH each affected match's new (liceId, scheduledAt).
   */
  async function handleGroupDrop(groupMatchIds: Set<string>, targetLiceId: string, slot: number) {
    if (!activeDay) return;
    setAutoDistributeError(null);

    // 1. Gather the group's matches in stable order. Numeric label
    //    sort matches the BE scheduler's ordering after the
    //    schedule overhaul; falls back to existing scheduledAt when
    //    label is missing.
    const matchNumeric = (m: ScheduleMatch): number => {
      const match = /(\d+)$/.exec(m.matchNumberLabel ?? '');
      return match ? Number.parseInt(match[1]!, 10) : Number.POSITIVE_INFINITY;
    };
    const groupMatches = matches
      .filter((m) => groupMatchIds.has(m.id))
      .sort((a, b) => matchNumeric(a) - matchNumeric(b));
    if (groupMatches.length === 0) return;

    // 2. Current occupants of the target lice on the active day,
    //    EXCLUDING the group's own matches (they're being repositioned).
    const occupants = matches
      .filter(
        (m) =>
          m.liceId === targetLiceId &&
          m.scheduledAt &&
          matchBelongsToDay(m.scheduledAt, activeDay) &&
          !groupMatchIds.has(m.id),
      )
      .map((m) => ({
        id: m.id,
        slot: isoToSlotTz(m.scheduledAt!, activeDay),
        span: Math.max(1, Math.floor(m.durationMinutes / SLOT_MINUTES)),
      }));

    // 3. Group's drop set, ordered. The .slot field is unused by
    //    placeMultiWithShift (it computes the real positions); the
    //    .span is what determines how much room the group takes.
    const dropped = groupMatches.map((m) => ({
      id: m.id,
      slot: 0,
      span: Math.max(1, Math.floor(m.durationMinutes / SLOT_MINUTES)),
    }));

    // 4. Compute the new layout.
    const placement = placeMultiWithShift({
      items: occupants,
      dropped,
      dropSlot: slot,
      gridEndSlot,
    });
    const slotById = new Map(placement.items.map((it) => [it.id, it.slot]));

    // 5. Apply optimistically.
    const updated = matches.map((m) => {
      const newSlot = slotById.get(m.id);
      if (newSlot == null) return m;
      const newScheduledAt = slotToTimeTz(newSlot, activeDay);
      const newLiceId = groupMatchIds.has(m.id) ? targetLiceId : (m.liceId ?? targetLiceId);
      if (m.scheduledAt === newScheduledAt && m.liceId === newLiceId) return m;
      return { ...m, scheduledAt: newScheduledAt, liceId: newLiceId };
    });
    setMatches(updated);
    setConflicts(detectConflicts(updated, eventTz, unknownFighterLabel));

    // 6. PATCH every match whose (liceId, scheduledAt) actually changed, as
    //    one reported operation — a partial failure rolls the board back to
    //    the server's version rather than leaving the group half-placed.
    const writes: Array<() => Promise<unknown>> = [];
    for (const item of placement.items) {
      const original = matches.find((m) => m.id === item.id);
      if (!original) continue;
      const newScheduledAt = slotToTimeTz(item.slot, activeDay);
      const newLiceId = groupMatchIds.has(item.id)
        ? targetLiceId
        : (original.liceId ?? targetLiceId);
      if (original.scheduledAt === newScheduledAt && original.liceId === newLiceId) continue;
      writes.push(() => saveMatchPosition(item.id, newLiceId, newScheduledAt));
    }
    await commitAll(writes);
  }

  /** Pool drop — all of the pool's matches as one group. */
  function handlePoolDrop(poolId: string, targetLiceId: string, slot: number) {
    const ids = new Set(matches.filter((m) => m.poolId === poolId).map((m) => m.id));
    return handleGroupDrop(ids, targetLiceId, slot);
  }

  function pushUndo(move: ScheduleMove) {
    setUndoStack((prev) => [...prev, move].slice(-20));
    setRedoStack([]);
  }

  async function applyMove(matchId: string, liceId: string | null, scheduledAt: string | null) {
    const updated = matches.map((m) => (m.id === matchId ? { ...m, liceId, scheduledAt } : m));
    setMatches(updated);
    setConflicts(detectConflicts(updated, eventTz, unknownFighterLabel));
    await commit(() => saveMatchPosition(matchId, liceId ?? '', scheduledAt ?? ''));
  }

  async function undo() {
    const last = undoStackRef.current[undoStackRef.current.length - 1];
    if (!last) return;
    setUndoStack((prev) => prev.slice(0, -1));
    setRedoStack((prev) => [...prev, last].slice(-20));
    await applyMove(last.matchId, last.fromLiceId, last.fromScheduledAt);
  }

  async function redo() {
    const last = redoStackRef.current[redoStackRef.current.length - 1];
    if (!last) return;
    setRedoStack((prev) => prev.slice(0, -1));
    setUndoStack((prev) => [...prev, last].slice(-20));
    await applyMove(last.matchId, last.toLiceId, last.toScheduledAt);
  }

  // Clear the undo/redo stacks when the active day changes — pushing
  // history across days would let an undo move a match back to a day
  // the operator isn't looking at, which is more confusing than useful.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional reset of undo/redo history on day change
    setUndoStack([]);
    setRedoStack([]);
  }, [activeDay]);

  // Keyboard shortcuts: Ctrl+Z / Cmd+Z = undo; Ctrl+Shift+Z / Cmd+Shift+Z
  // (or Ctrl+Y) = redo. Skip when focused on an input so typing in the
  // unscheduled-search field isn't trapped.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault();
        if (e.shiftKey) void redo();
        else void undo();
      } else if (e.key === 'y' || e.key === 'Y') {
        e.preventDefault();
        void redo();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function clearActiveDay() {
    if (!activeDay) return;
    const targets = matches.filter(
      (m) => m.scheduledAt && m.liceId && matchBelongsToDay(m.scheduledAt, activeDay),
    );
    if (targets.length === 0) {
      setPendingClear(false);
      return;
    }
    setClearingDay(true);
    try {
      // Fan out PATCHes in parallel. Last write wins per match — no
      // ordering required since each touches its own row.
      //
      // The local state is applied only AFTER the writes are known to have
      // landed. This used to run the other way round: a 401 emptied the whole
      // day on screen while every match stayed scheduled in the database, on
      // the pad and on the public display, and the operator then re-scheduled
      // on top of rows that were never cleared.
      const ok = await commitAll(
        targets.map(
          (m) => () =>
            mutateSchedule(`${apiUrl}/api/v1/matches/${m.id}/schedule`, {
              method: 'PATCH',
              body: { liceId: null, scheduledAt: null },
            }),
        ),
      );
      if (!ok) return;
      const targetIds = new Set(targets.map((m) => m.id));
      const updated = matches.map((m) =>
        targetIds.has(m.id) ? { ...m, liceId: null, scheduledAt: null } : m,
      );
      setMatches(updated);
      setConflicts(detectConflicts(updated, eventTz, unknownFighterLabel));
    } finally {
      setClearingDay(false);
      setPendingClear(false);
    }
  }

  const unscheduled = useMemo(() => matches.filter((m) => !m.scheduledAt || !m.liceId), [matches]);

  // Slice 4: group unscheduled pool matches so the operator can drag
  // a whole pool onto a cell instead of placing fights one by one.
  // Brackets are intentionally excluded — they need a different
  // grouping (by round) which is a separate sprint.
  type UnscheduledPool = {
    poolId: string;
    poolName: string;
    tournamentName: string | null;
    matchIds: string[];
  };
  const unscheduledPools = useMemo<UnscheduledPool[]>(() => {
    const byPool = new Map<string, UnscheduledPool>();
    for (const m of unscheduled) {
      if (!m.poolId || !m.poolName) continue;
      const existing = byPool.get(m.poolId);
      if (!existing) {
        byPool.set(m.poolId, {
          poolId: m.poolId,
          poolName: m.poolName,
          tournamentName: m.tournamentName,
          matchIds: [m.id],
        });
      } else {
        existing.matchIds.push(m.id);
      }
    }
    return Array.from(byPool.values()).sort((a, b) =>
      `${a.tournamentName ?? ''}|${a.poolName}`.localeCompare(
        `${b.tournamentName ?? ''}|${b.poolName}`,
      ),
    );
  }, [unscheduled]);

  // Set of match ids that belong to a fully-unscheduled pool; the
  // sidebar hides those individual chips (the pool block takes their
  // place). Once the operator places some of the pool's fights, the
  // remaining ones reappear as individual chips since the pool no
  // longer has all matches unscheduled.
  const matchIdsCoveredByPoolBlock = useMemo(() => {
    const ids = new Set<string>();
    // A pool only earns a block when ALL its matches are unscheduled —
    // otherwise the operator already started placing it manually and
    // we'd be hiding chips they want to keep dragging.
    for (const pool of unscheduledPools) {
      const totalForPool = matches.filter((m) => m.poolId === pool.poolId).length;
      if (totalForPool === pool.matchIds.length) {
        for (const id of pool.matchIds) ids.add(id);
      }
    }
    return ids;
  }, [unscheduledPools, matches]);

  // Same idea as pools, but for bracket matches grouped by phase round
  // (Play-ins / Round of 16 / Quarter-finals / …). The round is read
  // from each match's roundCode via parseBracketRound; the group key
  // includes the tournament name so two same-weapon tournaments don't
  // merge their rounds. Sorted by tournament then round order
  // (play-ins → final).
  type UnscheduledBracketRound = {
    key: string;
    label: string;
    order: number;
    tournamentName: string | null;
    matchIds: string[];
  };
  const unscheduledBracketRounds = useMemo<UnscheduledBracketRound[]>(() => {
    const byRound = new Map<string, UnscheduledBracketRound>();
    for (const m of unscheduled) {
      if (!m.phaseType || m.phaseType === 'pool') continue;
      const round = parseBracketRound(m.roundCode);
      if (!round) continue;
      const key = `${m.tournamentName ?? ''}|${round.token}`;
      const existing = byRound.get(key);
      if (!existing) {
        byRound.set(key, {
          key,
          label: round.label,
          order: round.order,
          tournamentName: m.tournamentName,
          matchIds: [m.id],
        });
      } else {
        existing.matchIds.push(m.id);
      }
    }
    return Array.from(byRound.values()).sort((a, b) => {
      const t = `${a.tournamentName ?? ''}`.localeCompare(`${b.tournamentName ?? ''}`);
      return t !== 0 ? t : a.order - b.order;
    });
  }, [unscheduled]);

  // Match ids hidden behind a bracket-round block — a round only earns
  // a block when ALL its matches (across the whole schedule, by the
  // same key) are unscheduled, mirroring the pool rule so manual
  // placements fall back to individual chips.
  const matchIdsCoveredByBracketRoundBlock = useMemo(() => {
    const ids = new Set<string>();
    for (const round of unscheduledBracketRounds) {
      const totalForRound = matches.filter((m) => {
        if (!m.phaseType || m.phaseType === 'pool') return false;
        const r = parseBracketRound(m.roundCode);
        return r != null && `${m.tournamentName ?? ''}|${r.token}` === round.key;
      }).length;
      if (totalForRound === round.matchIds.length) {
        for (const id of round.matchIds) ids.add(id);
      }
    }
    return ids;
  }, [unscheduledBracketRounds, matches]);

  const scheduledOnActiveDay = useMemo(
    () =>
      matches.filter(
        (m) => m.scheduledAt && m.liceId && matchBelongsToDay(m.scheduledAt, activeDay),
      ),
    [matches, activeDay],
  );

  // ── Block view model (one block per pool / bracket round) ─────────────────
  const dayBlocks = useMemo(
    () =>
      buildScheduleBlocks(
        scheduledOnActiveDay.map((m) => ({
          id: m.id,
          liceId: m.liceId,
          scheduledAt: m.scheduledAt,
          poolId: m.poolId,
          poolName: m.poolName,
          roundCode: m.roundCode,
          phaseType: m.phaseType,
          tournamentName: m.tournamentName,
          redFighterName: m.redFighterName,
          blueFighterName: m.blueFighterName,
          durationMinutes: m.durationMinutes,
          status: m.status,
        })),
      ),
    [scheduledOnActiveDay],
  );
  const tournamentColorByName = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const m of matches) {
      if (m.tournamentName) map.set(m.tournamentName, m.tournamentColor);
    }
    return map;
  }, [matches]);

  // Drop a dragged block / unscheduled pool / round onto a lice in the block
  // view: place its matches sequentially (5-min apart) after that lice's last
  // scheduled match (or 09:00 if empty). Persists each via the schedule PATCH.
  function handleBlockViewDrop(liceId: string, slot: number) {
    // A programme bar drag re-times the block (and cascades later blocks) —
    // the lice is irrelevant since these bars are full-width.
    if (dragViewBreak.current) {
      const { id } = dragViewBreak.current;
      dragViewBreak.current = null;
      setDragOverLiceId(null);
      void moveBlockTo(id, snapSlot(slot));
      return;
    }
    const ids =
      dragViewBlock.current?.matchIds ??
      dragPool.current?.matchIds ??
      dragBracketRound.current?.matchIds ??
      (dragMatch.current ? [dragMatch.current.id] : []);
    dragViewBlock.current = null;
    dragPool.current = null;
    dragBracketRound.current = null;
    dragMatch.current = null;
    setDragOverLiceId(null);
    if (ids.length === 0 || !activeDay) return;

    // Drop at the grid slot the operator released over (snapped to 15 min),
    // re-fanning the run onto the target lice and shifting any occupants.
    void handleGroupDrop(new Set(ids), liceId, snapSlot(slot));
  }

  // ── Live drift: how late/early each lice is running on the active day ──────
  const liceDrift = useMemo(
    () =>
      computeLiceDrift(
        scheduledOnActiveDay.map((m) => ({
          liceId: m.liceId,
          scheduledAt: m.scheduledAt,
          startedAt: m.startedAt,
          endedAt: m.endedAt,
          status: m.status,
          durationMinutes: m.durationMinutes,
          matchNumberLabel: m.matchNumberLabel,
        })),
      ),
    [scheduledOnActiveDay],
  );

  // Push a lice's not-yet-started future matches by the drift, to re-align the
  // rest of the day after a delay. Optimistic + per-match PATCH.
  function shiftLiceRemaining(liceId: string, driftMin: number) {
    if (!driftMin || !activeDay) return;
    const future = matches.filter(
      (m) =>
        m.liceId === liceId &&
        m.scheduledAt &&
        m.status === 'scheduled' &&
        matchBelongsToDay(m.scheduledAt, activeDay),
    );
    if (future.length === 0) return;
    const futureIds = new Set(future.map((f) => f.id));
    const shifted = (iso: string) =>
      new Date(new Date(iso).getTime() + driftMin * 60_000).toISOString();
    const updated = matches.map((m) =>
      futureIds.has(m.id) ? { ...m, scheduledAt: shifted(m.scheduledAt!) } : m,
    );
    setMatches(updated);
    setConflicts(detectConflicts(updated, eventTz, unknownFighterLabel));
    void commitAll(
      future.map((f) => () => saveMatchPosition(f.id, liceId, shifted(f.scheduledAt!))),
    );
  }

  // ── Block grid: edit popover + resize/edit commit handlers ────────────────
  const [editingBlock, setEditingBlock] = useState<ScheduleBlock | null>(null);
  const [editingBreak, setEditingBreak] = useState<BgvBreak | null>(null);
  // Double-click an empty cell → seed a new break draft for the create popover.
  const [creatingBreak, setCreatingBreak] = useState<BlockEditDraft | null>(null);
  const [blockEditBusy, setBlockEditBusy] = useState(false);

  // Optimistic apply + per-match PATCH for a set of (id, lice, time) updates.
  function applyMatchUpdates(updates: Array<{ id: string; liceId: string; scheduledAt: string }>) {
    if (updates.length === 0) return;
    const byId = new Map(updates.map((u) => [u.id, u]));
    const updated = matches.map((m) =>
      byId.has(m.id)
        ? { ...m, liceId: byId.get(m.id)!.liceId, scheduledAt: byId.get(m.id)!.scheduledAt }
        : m,
    );
    setMatches(updated);
    setConflicts(detectConflicts(updated, eventTz, unknownFighterLabel));
    void commitAll(updates.map((u) => () => saveMatchPosition(u.id, u.liceId, u.scheduledAt)));
  }

  // Vertical resize / end edit: respace each lice's sub-run of the block across
  // [start, newEnd] so a multi-lice bracket keeps its parallel layout.
  function resizeBlockTimeTo(block: ScheduleBlock, newEndSlot: number) {
    if (!activeDay) return;
    const startSlot = isoToSlotTz(block.startIso, activeDay);
    const byLice = new Map<string, ScheduleBlockMatch[]>();
    for (const m of block.matches) {
      const arr = byLice.get(m.liceId) ?? [];
      arr.push(m);
      byLice.set(m.liceId, arr);
    }
    const updates: Array<{ id: string; liceId: string; scheduledAt: string }> = [];
    for (const [liceId, ms] of byLice) {
      const sorted = [...ms].sort((a, b) => (a.startIso < b.startIso ? -1 : 1));
      const slots = respaceMatchesEvenly({ startSlot, endSlot: newEndSlot, count: sorted.length });
      sorted.forEach((m, i) =>
        updates.push({ id: m.id, liceId, scheduledAt: slotToTimeTz(slots[i]!, activeDay) }),
      );
    }
    applyMatchUpdates(updates);
  }

  // Shift the whole block (every lice) so it starts at newStartSlot, preserving
  // its internal layout.
  function retimeBlockStart(block: ScheduleBlock, newStartSlot: number) {
    if (!activeDay) return;
    const delta = newStartSlot - isoToSlotTz(block.startIso, activeDay);
    if (delta === 0) return;
    applyMatchUpdates(
      block.matches.map((m) => ({
        id: m.id,
        liceId: m.liceId,
        scheduledAt: slotToTimeTz(isoToSlotTz(m.startIso, activeDay) + delta, activeDay),
      })),
    );
  }

  // Horizontal resize / lice-span edit. A pool (single lice) relocates via the
  // group-drop placer (shifts occupants). A bracket re-fan across lices is
  // branch-aware and needs the backend — wired in Phase 3 (S12).
  // POST a group (pool or bracket sub-tree) to the branch-aware schedule-group
  // endpoint. Returns ok; the caller refetches.
  async function postScheduleGroup(
    matchIds: string[],
    liceIds: string[],
    startSlot: number,
    mode: 'pool' | 'bracket-branch',
  ): Promise<boolean> {
    if (!activeDay || matchIds.length === 0 || liceIds.length === 0) return false;
    try {
      await mutateSchedule(`${apiUrl}/api/v1/events/${eventId}/programme/schedule-group`, {
        method: 'POST',
        body: {
          matchIds,
          liceIds,
          startTime: slotToTimeTz(startSlot, activeDay),
          mode,
        },
      });
      return true;
    } catch (err) {
      // Keep the server's own reason. This endpoint can commit part of a re-fan
      // and still fail, so "could not re-fan" on its own leaves the operator
      // with nothing to act on.
      setAutoDistributeError(describeSaveError(err));
      return false;
    }
  }

  function changeBlockLices(block: ScheduleBlock, newLiceIds: string[]) {
    if (!newLiceIds[0] || !activeDay) return;
    const startSlot = isoToSlotTz(block.startIso, activeDay);
    if (block.kind === 'bracket') {
      // Branch-aware re-fan across the dragged lices (server-side).
      void (async () => {
        const ok = await postScheduleGroup(
          block.matches.map((m) => m.id),
          newLiceIds,
          startSlot,
          'bracket-branch',
        );
        // On failure `postScheduleGroup` has already surfaced the server's
        // reason, which beats the generic one this used to show. Either way the
        // board re-reads, because a failed re-fan may still have moved rows.
        await refetchScheduleAndBlocks();
        if (!ok) return;
      })();
      return;
    }
    // Pool / other: relocate to the single target lice client-side.
    void handleGroupDrop(new Set(block.matches.map((m) => m.id)), newLiceIds[0], startSlot);
  }

  // Move / resize / rename a break via the programme endpoints.
  async function saveBreakEdit(brk: BgvBreak, draft: BlockEditDraft) {
    setBlockEditBusy(true);
    try {
      // Which requests to send, and in what order, is decided by
      // `breakEditSteps` — the ordering is load-bearing (only /move cascades)
      // and now has tests. They run in sequence, not as a fan-out, and `commit`
      // stops at the first refusal rather than sending the rest against a block
      // the server did not update.
      const base = `${apiUrl}/api/v1/events/${eventId}/programme/blocks/${brk.id}`;
      const steps = breakEditSteps(
        {
          label: brk.label,
          startTime: brk.startTime,
          endTime: brk.endTime,
          colorHex: brk.colorHex ?? null,
        },
        draft,
      );
      const ok = await commit(async () => {
        for (const step of steps) {
          if (step.kind === 'label') {
            await mutateSchedule(base, {
              method: 'PATCH',
              body: { label: step.label, colorHex: step.colorHex },
            });
          } else if (step.kind === 'move') {
            await mutateSchedule(`${base}/move`, {
              method: 'PATCH',
              body: { newStartTime: step.newStartTime },
            });
          } else {
            await mutateSchedule(`${base}/resize`, {
              method: 'PATCH',
              body: { newEndTime: step.newEndTime },
            });
          }
        }
      });
      if (!ok) return;
      await refetchScheduleAndBlocks();
      onProgrammeMutated?.();
    } finally {
      setBlockEditBusy(false);
    }
  }

  async function resizeBreakTimeTo(brk: BgvBreak, newEndSlot: number) {
    const ok = await commit(() =>
      mutateSchedule(`${apiUrl}/api/v1/events/${eventId}/programme/blocks/${brk.id}/resize`, {
        method: 'PATCH',
        body: { newEndTime: slotToHHMM(newEndSlot, gridStartHour) },
      }),
    );
    if (!ok) return;
    await refetchScheduleAndBlocks();
    onProgrammeMutated?.();
  }

  // Create a new break from the double-click-an-empty-cell flow: POST a single
  // programme block on the active day, then refetch.
  async function createBreakBlock(draft: BlockEditDraft) {
    if (!activeDay) return;
    const dayIndex = days.indexOf(activeDay);
    if (dayIndex < 0) return;
    setBlockEditBusy(true);
    try {
      const ok = await commit(() =>
        mutateSchedule(`${apiUrl}/api/v1/events/${eventId}/programme/blocks`, {
          method: 'POST',
          body: {
            dayIndex,
            blockType: 'break',
            label: draft.label || t('organizer.schedulePage.grid.breakDefaultLabel'),
            startTime: draft.startHHMM,
            endTime: draft.endHHMM,
            colorHex: draft.colorHex || null,
          },
        }),
      );
      if (!ok) return;
      await refetchScheduleAndBlocks();
      onProgrammeMutated?.();
    } finally {
      setBlockEditBusy(false);
      setCreatingBreak(null);
    }
  }

  // Top-edge resize of a break/admin bar — moves start_time, end_time stays put.
  async function resizeBreakStartTo(brk: BgvBreak, newStartSlot: number) {
    const ok = await commit(() =>
      mutateSchedule(`${apiUrl}/api/v1/events/${eventId}/programme/blocks/${brk.id}/resize`, {
        method: 'PATCH',
        body: { newStartTime: slotToHHMM(newStartSlot, gridStartHour) },
      }),
    );
    if (!ok) return;
    await refetchScheduleAndBlocks();
    onProgrammeMutated?.();
  }

  function savePopover(draft: BlockEditDraft) {
    if (editingBreak) {
      const brk = editingBreak;
      setEditingBreak(null);
      void saveBreakEdit(brk, draft);
      return;
    }
    if (editingBlock) {
      const block = editingBlock;
      setEditingBlock(null);
      retimeBlockStart(block, hhmmToSlot(draft.startHHMM, gridStartHour));
      const cur = [...block.liceIds].sort();
      const next = [...draft.liceIds].sort();
      const changed = cur.length !== next.length || cur.some((v, i) => v !== next[i]);
      if (changed) changeBlockLices(block, draft.liceIds);
    }
  }

  // Batch-schedule every ticked group via the branch-aware endpoint: each pool
  // onto the least-loaded lice, each bracket round branch-aware across all
  // lices. Overlap-free (the endpoint appends after occupants); one refetch.
  async function scheduleSelected() {
    if (!activeDay) return;
    const pools = unscheduledPools.filter(
      (p) =>
        tickedKeys.has(`pool:${p.poolId}`) &&
        p.matchIds.every((id) => matchIdsCoveredByPoolBlock.has(id)),
    );
    const brackets = unscheduledBracketRounds.filter((r) => tickedKeys.has(`round:${r.key}`));
    if (pools.length === 0 && brackets.length === 0) {
      setTickedKeys(new Set());
      return;
    }
    setAutoDistributeError(null);
    // Axis space, not instant space — see BATCH_SCHEDULE_START_HHMM.
    const dayStartSlot = hhmmToSlot(BATCH_SCHEDULE_START_HHMM, gridStartHour);
    const lastEnd = (liceId: string) => {
      const onLice = scheduledOnActiveDay.filter((m) => m.liceId === liceId && m.scheduledAt);
      if (onLice.length === 0) return dayStartSlot;
      return Math.max(
        ...onLice.map(
          (m) =>
            isoToSlotTz(m.scheduledAt!, activeDay) +
            Math.max(1, Math.floor(m.durationMinutes / SLOT_MINUTES)),
        ),
      );
    };
    const loads = lices.map((l) => ({ liceId: l.id, lastEndSlot: lastEnd(l.id) }));
    const placements = distributeGroups({
      groups: pools.map((p) => ({ key: p.poolId, spanSlots: p.matchIds.length })),
      loads,
      dayStartSlot,
    });
    let okAll = true;
    for (const pl of placements) {
      const pool = pools.find((p) => p.poolId === pl.key);
      if (pool) {
        okAll =
          (await postScheduleGroup(pool.matchIds, [pl.liceId], pl.startSlot, 'pool')) && okAll;
      }
    }
    const allLiceIds = lices.map((l) => l.id);
    for (const r of brackets) {
      okAll =
        (await postScheduleGroup(r.matchIds, allLiceIds, dayStartSlot, 'bracket-branch')) && okAll;
    }
    if (!okAll) setAutoDistributeError(t('admin.common.someGroupsNotScheduled'));
    await refetchScheduleAndBlocks();
    setTickedKeys(new Set());
  }

  // ── Export CSV + Print (client-side, from loaded matches) ─────────────────
  const liceNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const l of lices) map.set(l.id, l.name);
    return map;
  }, [lices]);

  function exportCsv() {
    const csv = scheduleToCsv(matches, liceNameById, eventTz, {
      day: t('organizer.schedulePage.grid.printColDay'),
      lice: t('organizer.schedulePage.grid.printColLice'),
      start: t('organizer.schedulePage.grid.printColStart'),
      round: t('organizer.schedulePage.grid.printColRound'),
      tournament: t('organizer.schedulePage.grid.printColTournament'),
      group: t('organizer.schedulePage.grid.printColGroup'),
      red: t('organizer.schedulePage.grid.printColRed'),
      blue: t('organizer.schedulePage.grid.printColBlue'),
      status: t('organizer.schedulePage.grid.printColStatus'),
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `schedule-${eventId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function printSchedule() {
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const rows = matches
      .filter((m) => m.scheduledAt && m.liceId)
      .map((m) => ({
        day: m.scheduledAt!.slice(0, 10),
        lice: liceNameById.get(m.liceId!) ?? m.liceId!,
        startIso: m.scheduledAt!,
        cells: [
          m.scheduledAt!.slice(0, 10),
          liceNameById.get(m.liceId!) ?? m.liceId!,
          new Intl.DateTimeFormat(localeToBcp47(locale), {
            hour: '2-digit',
            minute: '2-digit',
          }).format(new Date(m.scheduledAt!)),
          m.roundCode || m.matchNumberLabel,
          m.tournamentName ?? '',
          t('organizer.schedulePage.grid.versus', {
            a: m.redFighterName ?? '?',
            b: m.blueFighterName ?? '?',
          }),
        ],
      }))
      .sort(
        (a, b) =>
          a.day.localeCompare(b.day) ||
          a.lice.localeCompare(b.lice, undefined, { numeric: true }) ||
          a.startIso.localeCompare(b.startIso),
      );
    const body = rows
      .map((r) => `<tr>${r.cells.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`)
      .join('');
    const w = window.open('', '_blank');
    if (!w) return;
    const printTitle = esc(t('organizer.schedulePage.grid.printTitle'));
    const headers = [
      t('organizer.schedulePage.grid.printColDay'),
      t('organizer.schedulePage.grid.printColLice'),
      t('organizer.schedulePage.grid.printColStart'),
      t('organizer.schedulePage.grid.printColRound'),
      t('organizer.schedulePage.grid.printColTournament'),
      t('organizer.schedulePage.grid.printColMatch'),
    ]
      .map((h) => `<th>${esc(h)}</th>`)
      .join('');
    w.document.write(
      `<!doctype html><html><head><title>${printTitle}</title><style>` +
        `body{font-family:system-ui,sans-serif;padding:24px;color:#111}` +
        `h1{font-size:18px}table{border-collapse:collapse;width:100%;font-size:12px}` +
        `th,td{border:1px solid #ccc;padding:4px 8px;text-align:left}th{background:#f3f4f6}` +
        `</style></head><body><h1>${printTitle}</h1><table><thead><tr>` +
        headers +
        `</tr></thead><tbody>${body}</tbody></table></body></html>`,
    );
    w.document.close();
    w.focus();
    w.print();
  }

  // Per-run grid headers: pools AND bracket rounds group into contiguous
  // same-key runs per lice (computeHeaderRuns). Separating a match —
  // another lice, a time gap, or a different match wedged in — splits the
  // run, so each cluster keeps its own header, and the header's drag /
  // clear scopes to just that cluster's matches.
  type HeaderRunGroup = {
    key: string;
    label: string;
    tournamentName: string | null;
    tournamentColor: string | null;
    startSlot: number;
    /** Exclusive end slot — last match's slot + its span. The band's
     *  bottom edge sits here so it visually wraps the run. */
    endSlot: number;
    liceIndex: number;
    matchCount: number;
    matchIds: string[];
  };
  const headerRunsOnActiveDay = useMemo<HeaderRunGroup[]>(() => {
    if (!activeDay) return [];
    const items: HeaderRunItem[] = [];
    const metaById = new Map<string, ScheduleMatch>();
    for (const m of scheduledOnActiveDay) {
      // visibleLices, so run headers sit in the columns the body actually uses.
      const liceIndex = visibleLices.findIndex((l) => l.id === m.liceId);
      if (liceIndex === -1) continue;
      // Pool matches key by pool; bracket matches key by tournament +
      // phase round (the same key the sidebar round blocks use). Other
      // matches get no header.
      let key: string | null = null;
      if (m.poolId && m.poolName) {
        key = `pool:${m.poolId}`;
      } else if (m.phaseType && m.phaseType !== 'pool') {
        const round = parseBracketRound(m.roundCode);
        if (round) key = `round:${m.tournamentName ?? ''}|${round.token}`;
      }
      if (!key) continue;
      metaById.set(m.id, m);
      items.push({
        id: m.id,
        key,
        liceIndex,
        slot: isoToSlotTz(m.scheduledAt!, activeDay),
        span: Math.max(1, Math.floor(m.durationMinutes / SLOT_MINUTES)),
      });
    }
    return computeHeaderRuns(items).map((run) => {
      const first = metaById.get(run.matchIds[0]!)!;
      const label = first.poolName ?? parseBracketRound(first.roundCode)?.label ?? '';
      return {
        key: `${run.key}@${run.liceIndex}:${run.startSlot}`,
        label,
        tournamentName: first.tournamentName,
        tournamentColor: first.tournamentColor,
        startSlot: run.startSlot,
        endSlot: run.endSlot,
        liceIndex: run.liceIndex,
        matchCount: run.matchIds.length,
        matchIds: run.matchIds,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- isoToSlotTz is a stable pure helper; excluded intentionally
  }, [scheduledOnActiveDay, visibleLices, activeDay]);

  // Reserve-space layout: distinct slots where a run header begins. Every
  // content item at/after such a slot shifts down POOL_HEADER_SPAN rows per
  // header above it, so the header sits in its own band instead of covering
  // the run's first matches. `rowFor(slot)` maps a content slot to its
  // display grid row (slot + 3 base: venue band + lice header + 1-based).
  const poolHeaderStartSlots = useMemo(
    () => headerRunsOnActiveDay.map((g) => g.startSlot),
    [headerRunsOnActiveDay],
  );
  const rowFor = (slot: number): number =>
    slot + 3 + rowShiftForSlot(slot, poolHeaderStartSlots, POOL_HEADER_SPAN);

  const [pendingRunClear, setPendingRunClear] = useState<HeaderRunGroup | null>(null);
  const [clearingRun, setClearingRun] = useState(false);

  /** Unschedule one run's matches (the header's click action). Per-match
   *  PATCHes rather than the pool-day DELETE endpoint so it works for any
   *  run subset — a separated pool cluster or a bracket round alike. */
  async function clearRun(group: HeaderRunGroup) {
    setClearingRun(true);
    try {
      const ids = new Set(group.matchIds);
      const updated = matches.map((m) =>
        ids.has(m.id) ? { ...m, liceId: null, scheduledAt: null } : m,
      );
      setMatches(updated);
      setConflicts(detectConflicts(updated, eventTz, unknownFighterLabel));
      await commitAll(group.matchIds.map((id) => () => saveMatchPosition(id, '', '')));
    } finally {
      setClearingRun(false);
      setPendingRunClear(null);
    }
  }

  // Slice 7: programme blocks (admin / break) scoped to the active day,
  // with their start/end converted into grid slot indices for rendering.
  const blocksOnActiveDay = useMemo(() => {
    if (!activeDay) return [] as Array<ProgrammeBlockRow & { startSlot: number; span: number }>;
    const dayIndex = days.indexOf(activeDay);
    if (dayIndex < 0) return [];
    return programmeBlocksForDay(programmeBlocks, dayIndex, gridStartHour);
  }, [programmeBlocks, activeDay, days, gridStartHour]);

  // The board's visible vertical extent grows to cover the latest block/break
  // and the configured day-end. BOTH views use it — the detailed grid used to
  // keep a fixed 08:00–20:00 window, so a 21:00 final rendered in an implicit
  // row with no time label and no drop target behind it: visible, unreadable
  // and impossible to move.
  const gridEndSlot = useMemo(() => {
    const blockEndSlots = dayBlocks.map((b) => isoToSlotTz(b.endIso, activeDay));
    const breakEndSlots = blocksOnActiveDay
      .filter((b) => b.blockType !== 'competition')
      .map((b) => b.startSlot + b.span);
    const dayEndHHMM = blocksOnActiveDay.reduce<string | null>(
      (max, b) => (max && max >= b.endTime ? max : b.endTime),
      null,
    );
    return computeGridEndSlot({
      blockEndSlots,
      breakEndSlots,
      dayEndHHMM,
      startHour: gridStartHour,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- isoToSlotTz is a stable pure helper; excluded intentionally
  }, [dayBlocks, blocksOnActiveDay, activeDay]);

  // Admin / break / workshop bars for the block grid (competition excluded —
  // those render as the pool/round blocks).
  const bgvBreaks = useMemo<BgvBreak[]>(
    () =>
      blocksOnActiveDay
        .filter((b) => b.blockType !== 'competition')
        .map((b) => ({
          id: b.id,
          startSlot: b.startSlot,
          span: b.span,
          label: b.label,
          startTime: b.startTime,
          endTime: b.endTime,
          kind: b.blockType,
          colorHex: b.colorHex ?? null,
        })),
    [blocksOnActiveDay],
  );

  // S7b: conflict (fighter double-booked) + overlap (two blocks share a lice &
  // time) detection, surfaced as tints on the block grid + banners.
  const conflictMatchIds = useMemo(() => {
    if (conflicts.length === 0) return EMPTY_STRING_SET;
    const labels = new Set<string>();
    for (const c of conflicts) {
      labels.add(c.matchA);
      labels.add(c.matchB);
    }
    const ids = new Set<string>();
    for (const m of scheduledOnActiveDay) if (labels.has(m.matchNumberLabel)) ids.add(m.id);
    return ids;
  }, [conflicts, scheduledOnActiveDay]);
  const dayOverlaps = useMemo(() => detectScheduleOverlaps(dayBlocks), [dayBlocks]);
  /**
   * Fights sitting inside a break or admin bar. Warned, never blocked — see
   * `bar-collisions.ts`. Neither view checked this before: the Blocks view
   * tinted its drag ghost red and then dropped the fight anyway, and the
   * Detailed view never looked at all.
   */
  const barCollisions = useMemo(() => {
    const bars = bgvBreaks.map((b) => ({
      id: b.id,
      label: b.label,
      startSlot: b.startSlot,
      span: b.span,
    }));
    const placed = scheduledOnActiveDay
      .filter((m) => m.scheduledAt)
      .map((m) => ({
        id: m.id,
        matchNumberLabel: m.matchNumberLabel,
        startSlot: isoToSlotTz(m.scheduledAt!, activeDay),
        span: Math.max(1, Math.round(m.durationMinutes / SLOT_MINUTES)),
      }));
    return detectBarCollisions(placed, bars);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- isoToSlotTz is a stable pure helper; excluded intentionally
  }, [bgvBreaks, scheduledOnActiveDay, activeDay]);
  const overlapBlockKeys = useMemo(() => {
    if (dayOverlaps.length === 0) return EMPTY_STRING_SET;
    const keys = new Set<string>();
    for (const o of dayOverlaps) {
      keys.add(o.aKey);
      keys.add(o.bKey);
    }
    return keys;
  }, [dayOverlaps]);

  // Slice 4: slot index for "now" on the active day. Null when the
  // active day isn't today, when the current time is before the grid
  // start, or when it's past the grid end — caller renders nothing in
  // those cases.
  //
  // Not memoized: `nowSlotForDay` is a cheap pure call, and wrapping it made
  // the React Compiler bail out of optimizing the whole component because it
  // could not preserve a manual memo that depends on `gridEndSlot`.
  const nowSlotRaw = activeDay
    ? nowSlotForDay(now.toISOString(), activeDay, eventTz, gridStartHour)
    : null;
  // Gated on the DYNAMIC end, not the 20:00 default. An event running finals to
  // 21:30 has an axis reaching 22:00, and the red "now" marker used to vanish
  // at 20:00 from a board that visibly still had two hours of programme on it —
  // exactly when the drift it measures is largest.
  const nowSlot = nowSlotRaw !== null && nowSlotRaw < gridEndSlot ? nowSlotRaw : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <span className="w-8 h-8 border-2 border-border border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="w-full">
      {/* Day tabs — one per event day. Even on a single-day event we render
          a non-clickable label so the operator always sees which day the
          grid is showing. Multi-day events get a clickable pill per day
          that switches activeDay. */}
      {days.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            {days.map((day, idx) => {
              const active = day === activeDay;
              const single = days.length === 1;
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => setActiveDay(day)}
                  disabled={single}
                  className={[
                    'rounded-full border px-4 py-1.5 text-xs font-semibold transition-colors',
                    active
                      ? 'border-accent bg-accent text-accent-foreground'
                      : 'border-border bg-surface text-foreground-secondary hover:border-muted',
                    single ? 'cursor-default' : '',
                  ].join(' ')}
                >
                  {single
                    ? formatDayLabel(day)
                    : t('organizer.schedulePage.grid.dayTab', {
                        n: idx + 1,
                        date: formatDayLabel(day),
                      })}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            {/* Slice 9: undo/redo for drag-and-drop moves. */}
            <button
              type="button"
              onClick={() => void undo()}
              disabled={undoStack.length === 0}
              title={t('organizer.schedulePage.grid.undoTitle')}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground-secondary hover:bg-background disabled:opacity-40"
            >
              {t('organizer.schedulePage.grid.undo')}
            </button>
            <button
              type="button"
              onClick={() => void redo()}
              disabled={redoStack.length === 0}
              title={t('organizer.schedulePage.grid.redoTitle')}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground-secondary hover:bg-background disabled:opacity-40"
            >
              {t('organizer.schedulePage.grid.redo')}
            </button>
            {/* Clear active day — Slice 3. Disables when the active day has
                nothing to clear, opens a confirm modal otherwise. */}
            <button
              type="button"
              onClick={() => setPendingClear(true)}
              disabled={clearingDay || scheduledOnActiveDay.length === 0}
              className="rounded-md border border-danger/30 px-3 py-1.5 text-xs font-semibold text-danger hover:bg-danger/10 disabled:opacity-50 disabled:hover:bg-transparent"
            >
              {t('organizer.schedulePage.grid.clearDayButton', {
                count: scheduledOnActiveDay.length,
              })}
            </button>
            {/* Slice C: spawn a new lice. Toggles an inline form below
                the toolbar; submit POSTs to /events/:id/lices and the
                new column appears in the grid live. */}
            <button
              type="button"
              onClick={() => setShowAddLice((v) => !v)}
              className="rounded-md border border-dashed border-border px-3 py-1.5 text-xs font-semibold text-foreground-secondary hover:border-muted hover:bg-background"
            >
              {t('organizer.schedulePage.grid.addLice')}
            </button>
          </div>
        </div>
      )}

      {showAddLice && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs">
          <label className="flex items-center gap-1.5">
            <span className="text-foreground-secondary">
              {t('organizer.schedulePage.editPopover.nameLabel')}
            </span>
            <input
              type="text"
              value={newLiceName}
              onChange={(e) => setNewLiceName(e.target.value)}
              placeholder={t('organizer.schedulePage.grid.newLicePlaceholder')}
              maxLength={50}
              className="rounded-md border border-border px-2 py-1 text-xs"
              // eslint-disable-next-line jsx-a11y/no-autofocus -- intentional focus on the inline new-lice name field
              autoFocus
            />
          </label>
          <label className="flex items-center gap-1.5">
            <span className="text-foreground-secondary">
              {t('organizer.schedulePage.editPopover.colorLabel')}
            </span>
            <input
              type="color"
              value={newLiceColor}
              onChange={(e) => setNewLiceColor(e.target.value)}
              className="h-7 w-10 cursor-pointer rounded border border-border"
            />
          </label>
          <button
            type="button"
            onClick={() => void addLice()}
            disabled={addLiceBusy || !newLiceName.trim()}
            className="rounded-md bg-strong px-3 py-1 text-xs font-semibold text-strong-foreground hover:bg-strong-hover disabled:opacity-50"
          >
            {addLiceBusy
              ? t('organizer.schedulePage.grid.adding')
              : t('organizer.schedulePage.grid.add')}
          </button>
          <button
            type="button"
            onClick={() => {
              setShowAddLice(false);
              setNewLiceName('');
              setAddLiceError(null);
            }}
            className="rounded-md border border-border px-3 py-1 text-xs font-semibold text-foreground-secondary hover:bg-border"
          >
            {t('organizer.schedulePage.editPopover.cancel')}
          </button>
          {addLiceError && <span className="text-danger">{addLiceError}</span>}
        </div>
      )}

      {fetchError && (
        <div
          role="alert"
          className="bg-danger/10 border border-danger/30 rounded-xl px-4 py-3 mb-4 text-sm flex items-start gap-3"
        >
          <span className="font-bold text-danger">
            {t('organizer.schedulePage.grid.loadFailedPrefix')}
          </span>
          <span className="text-danger">{fetchError}</span>
          <button
            type="button"
            onClick={() => setFetchError(null)}
            className="ml-auto text-danger hover:text-danger-hover font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {saveError && (
        <div
          role="alert"
          className="bg-danger/10 border border-danger/30 rounded-xl px-4 py-3 mb-4 text-sm flex items-start gap-3"
        >
          <span className="font-bold text-danger">
            {t('organizer.schedulePage.grid.saveFailedPrefix')}
          </span>
          <span className="text-danger">{saveError}</span>
          <button
            type="button"
            onClick={() => setSaveError(null)}
            className="ml-auto text-danger hover:text-danger-hover font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {autoDistributeError && (
        <div className="bg-danger/10 border border-danger/30 rounded-xl px-4 py-3 mb-4 text-sm flex items-start gap-3">
          <span className="font-bold text-danger">
            {t('organizer.schedulePage.grid.autoDistributeFailedPrefix')}
          </span>
          <span className="text-danger">{autoDistributeError}</span>
          <button
            type="button"
            onClick={() => setAutoDistributeError(null)}
            className="ml-auto text-danger hover:text-danger-hover font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {conflicts.length > 0 && (
        <div className="bg-danger/10 border border-danger/30 rounded-xl px-4 py-3 mb-6 text-sm">
          <p className="font-bold text-danger mb-1">
            {conflicts.length === 1
              ? t('organizer.schedulePage.grid.conflictCountSingular', {
                  count: conflicts.length,
                })
              : t('organizer.schedulePage.grid.conflictCountPlural', { count: conflicts.length })}
          </p>
          <ul className="list-disc list-inside text-danger space-y-0.5">
            {conflicts.map((c, i) => (
              <li key={i}>
                <strong>{c.personName}</strong>{' '}
                {t('organizer.schedulePage.grid.conflictSegIsInBoth')} <em>{c.matchA}</em>{' '}
                {t('organizer.schedulePage.grid.conflictSegAnd')} <em>{c.matchB}</em>{' '}
                {t('organizer.schedulePage.grid.conflictSegAt')} {c.time}
              </li>
            ))}
          </ul>
        </div>
      )}

      {barCollisions.length > 0 && (
        <div className="bg-warning/10 border border-warning/30 rounded-xl px-4 py-2 mb-4 text-sm">
          <p className="font-semibold text-warning">
            {barCollisions.length === 1
              ? t('organizer.schedulePage.grid.barCollisionSingular', {
                  count: barCollisions.length,
                })
              : t('organizer.schedulePage.grid.barCollisionPlural', {
                  count: barCollisions.length,
                })}
          </p>
          <ul className="mt-1 space-y-0.5 text-xs text-foreground-secondary">
            {barCollisions.slice(0, 6).map((c) => (
              <li key={`${c.matchId}-${c.barId}`}>
                {t('organizer.schedulePage.grid.barCollisionLine', {
                  match: c.matchLabel,
                  bar: c.barLabel,
                })}
              </li>
            ))}
          </ul>
        </div>
      )}

      {dayOverlaps.length > 0 && (
        <div className="bg-warning/10 border border-warning/30 rounded-xl px-4 py-2 mb-4 text-sm">
          <p className="font-semibold text-warning">
            {dayOverlaps.length === 1
              ? t('organizer.schedulePage.grid.overlapCountSingular', {
                  count: dayOverlaps.length,
                })
              : t('organizer.schedulePage.grid.overlapCountPlural', { count: dayOverlaps.length })}
          </p>
        </div>
      )}

      <div className="mb-3 flex items-center gap-1.5">
        <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-muted">
          {t('organizer.schedulePage.grid.viewLabel')}
        </span>
        {(['blocks', 'grid'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => setViewMode(mode)}
            className={[
              'rounded-full border px-3 py-1 text-xs font-semibold transition-colors',
              viewMode === mode
                ? 'border-accent bg-accent text-accent-foreground'
                : 'border-border bg-surface text-foreground-secondary hover:border-muted',
            ].join(' ')}
          >
            {mode === 'blocks'
              ? t('organizer.schedulePage.grid.viewBlocks')
              : t('organizer.schedulePage.grid.viewDetailed')}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={exportCsv}
            className="rounded-md border border-border px-3 py-1 text-xs font-medium text-foreground-secondary hover:bg-background"
          >
            {t('organizer.schedulePage.grid.exportCsv')}
          </button>
          <button
            type="button"
            onClick={printSchedule}
            className="rounded-md border border-border px-3 py-1 text-xs font-medium text-foreground-secondary hover:bg-background"
          >
            {t('organizer.schedulePage.grid.print')}
          </button>
        </div>
      </div>

      {/* Retractable LEFT panel: Unscheduled (top) + Configure (below); the
          schedule canvas takes the rest. Collapses to a thin rail. */}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div
          style={
            panelCollapsed ? undefined : ({ '--panel-w': `${panelWidth}px` } as React.CSSProperties)
          }
          className={
            panelCollapsed
              ? 'w-full lg:sticky lg:top-4 lg:w-10 lg:flex-shrink-0 lg:self-start'
              : 'relative w-full space-y-4 lg:sticky lg:top-4 lg:w-[var(--panel-w)] lg:flex-shrink-0 lg:self-start'
          }
        >
          {!panelCollapsed && (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label={t('organizer.schedulePage.grid.panelResizeAria')}
              onPointerDown={beginPanelResize}
              className="absolute -right-1 top-0 z-20 hidden h-full w-2 cursor-col-resize touch-none bg-transparent hover:bg-accent/30 lg:block"
            />
          )}
          <div className="mb-2 flex items-center justify-between gap-2">
            {!panelCollapsed && (
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
                {t('organizer.schedulePage.grid.unscheduledHeading', {
                  count: unscheduled.length,
                })}
              </h2>
            )}
            <button
              type="button"
              aria-expanded={!panelCollapsed}
              aria-label={
                panelCollapsed
                  ? t('organizer.schedulePage.grid.expandPanel')
                  : t('organizer.schedulePage.grid.collapsePanel')
              }
              onClick={() => setPanelCollapsed((v) => !v)}
              className="rounded-md border border-border px-2 py-0.5 text-sm font-semibold text-foreground-secondary hover:bg-background"
            >
              {panelCollapsed ? '»' : '«'}
            </button>
          </div>
          {!panelCollapsed && (
            <>
              {tickedKeys.size > 0 && (
                <button
                  type="button"
                  onClick={() => void scheduleSelected()}
                  className="mb-2 w-full rounded-md bg-accent px-2 py-1 text-xs font-semibold text-accent-foreground hover:bg-accent-hover"
                >
                  {t('organizer.schedulePage.grid.scheduleSelected', { count: tickedKeys.size })}
                </button>
              )}
              <div
                className="flex flex-col gap-1.5 min-h-[100px] border-2 border-dashed border-border rounded-xl p-2 max-h-[60vh] overflow-y-auto"
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  // Dropping a pool / bracket-round block back onto the
                  // sidebar = no-op.
                  if (dragPool.current) {
                    dragPool.current = null;
                    return;
                  }
                  if (dragBracketRound.current) {
                    dragBracketRound.current = null;
                    return;
                  }
                  const match = dragMatch.current;
                  if (!match) return;
                  if (match.liceId === null && match.scheduledAt === null) {
                    dragMatch.current = null;
                    return;
                  }
                  pushUndo({
                    matchId: match.id,
                    fromLiceId: match.liceId,
                    fromScheduledAt: match.scheduledAt,
                    toLiceId: null,
                    toScheduledAt: null,
                  });
                  const updated = matches.map((m) =>
                    m.id === match.id ? { ...m, liceId: null, scheduledAt: null } : m,
                  );
                  setMatches(updated);
                  setConflicts(detectConflicts(updated, eventTz, unknownFighterLabel));
                  void commit(() => saveMatchPosition(match.id, '', ''));
                  dragMatch.current = null;
                }}
              >
                {unscheduled.length === 0 ? (
                  <p className="px-1 py-2 text-xs italic text-muted">
                    {t('organizer.schedulePage.grid.allPlaced')}
                  </p>
                ) : (
                  <>
                    {/* Slice 4: drag a whole pool onto a cell to fan its
                    matches out across lices. Only fully-unscheduled
                    pools render as blocks — the moment the operator
                    places one fight manually, the rest fall back to
                    individual chips. */}
                    {unscheduledPools
                      .filter((p) => p.matchIds.every((id) => matchIdsCoveredByPoolBlock.has(id)))
                      .map((pool) => (
                        <div
                          key={pool.poolId}
                          draggable
                          onDragStart={() => {
                            dragPool.current = { poolId: pool.poolId, matchIds: pool.matchIds };
                            dragMatch.current = null;
                            dragBracketRound.current = null;
                          }}
                          onDragEnd={() => {
                            dragPool.current = null;
                          }}
                          className="cursor-grab rounded-md border-2 border-dashed border-border bg-border px-2 py-1.5 text-xs hover:border-muted hover:bg-background"
                          title={t('organizer.schedulePage.grid.groupChipTitle', {
                            count: pool.matchIds.length,
                          })}
                        >
                          <div className="flex items-start gap-1.5">
                            <input
                              type="checkbox"
                              className="mt-0.5"
                              checked={tickedKeys.has(`pool:${pool.poolId}`)}
                              onClick={(e) => e.stopPropagation()}
                              onChange={() => toggleTicked(`pool:${pool.poolId}`)}
                              aria-label={t('organizer.schedulePage.grid.selectAria', {
                                label: pool.poolName,
                              })}
                            />
                            <div className="min-w-0">
                              <div className="font-bold text-foreground truncate">
                                {pool.poolName}
                              </div>
                              <div className="text-[10px] text-foreground-secondary truncate">
                                {t('organizer.schedulePage.grid.groupChipSub', {
                                  tournament: pool.tournamentName ?? '',
                                  count: pool.matchIds.length,
                                })}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    {/* Bracket rounds group the same way pools do — drag a
                    whole round (Play-ins / Round of 16 / …) onto a cell
                    to fan its matches down a lice. Amber accent mirrors
                    the bracket theme on the individual chips. */}
                    {unscheduledBracketRounds
                      .filter((r) =>
                        r.matchIds.every((id) => matchIdsCoveredByBracketRoundBlock.has(id)),
                      )
                      .map((round) => (
                        <div
                          key={round.key}
                          draggable
                          onDragStart={() => {
                            dragBracketRound.current = { key: round.key, matchIds: round.matchIds };
                            dragMatch.current = null;
                            dragPool.current = null;
                          }}
                          onDragEnd={() => {
                            dragBracketRound.current = null;
                          }}
                          className="cursor-grab rounded-md border-2 border-dashed border-amber-400 bg-amber-50 px-2 py-1.5 text-xs hover:border-amber-500 hover:bg-amber-100"
                          title={t('organizer.schedulePage.grid.groupChipTitle', {
                            count: round.matchIds.length,
                          })}
                        >
                          <div className="flex items-start gap-1.5">
                            <input
                              type="checkbox"
                              className="mt-0.5"
                              checked={tickedKeys.has(`round:${round.key}`)}
                              onClick={(e) => e.stopPropagation()}
                              onChange={() => toggleTicked(`round:${round.key}`)}
                              aria-label={t('organizer.schedulePage.grid.selectAria', {
                                label: round.label,
                              })}
                            />
                            <div className="min-w-0">
                              <div className="font-bold text-amber-900 truncate">{round.label}</div>
                              <div className="text-[10px] text-amber-700 truncate">
                                {t('organizer.schedulePage.grid.groupChipSub', {
                                  tournament: round.tournamentName ?? '',
                                  count: round.matchIds.length,
                                })}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    {unscheduled
                      .filter(
                        (m) =>
                          !matchIdsCoveredByPoolBlock.has(m.id) &&
                          !matchIdsCoveredByBracketRoundBlock.has(m.id),
                      )
                      .map((m) => (
                        <MatchChip
                          key={m.id}
                          match={m}
                          slug={slug}
                          eventId={eventId}
                          saving={saving === m.id}
                          onDragStart={() => {
                            dragMatch.current = m;
                            dragPool.current = null;
                            dragBracketRound.current = null;
                          }}
                        />
                      ))}
                  </>
                )}
              </div>
              {configurePanel}
            </>
          )}
        </div>

        {/* Day grid — lice as columns, time as rows. Columns flex to fill the canvas. */}
        <div className="flex-1 min-w-0 overflow-x-auto">
          {lices.length === 0 ? (
            <p className="text-muted text-sm">{t('organizer.schedulePage.blockGrid.noLices')}</p>
          ) : !activeDay ? (
            <p className="text-muted text-sm">{t('organizer.schedulePage.grid.noEventDate')}</p>
          ) : viewMode === 'blocks' ? (
            <>
              {/* Legend (click a tournament to focus) + conflict count + zoom. */}
              <div className="mb-2 flex flex-wrap items-center gap-2">
                {[...tournamentColorByName.keys()].map((name) => {
                  const active = focusedTournament === name;
                  return (
                    <button
                      key={name}
                      type="button"
                      onClick={() => setFocusedTournament(active ? null : name)}
                      className={[
                        'flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors',
                        active
                          ? 'border-strong bg-strong text-strong-foreground'
                          : 'border-border bg-surface text-foreground-secondary hover:bg-background',
                      ].join(' ')}
                    >
                      <span
                        className={`h-2 w-2 rounded-full ${accentClassFor(tournamentColorByName.get(name) ?? null)}`}
                      />
                      <span className="max-w-[10rem] truncate">{name}</span>
                    </button>
                  );
                })}
                {focusedTournament && (
                  <button
                    type="button"
                    onClick={() => setFocusedTournament(null)}
                    className="text-[11px] font-medium text-muted hover:text-foreground-secondary"
                  >
                    {t('organizer.schedulePage.grid.clearFocus')}
                  </button>
                )}
                {conflicts.length > 0 && (
                  <span className="rounded-full border border-danger/30 bg-danger/10 px-2 py-0.5 text-[11px] font-semibold text-danger">
                    {conflicts.length === 1
                      ? t('organizer.schedulePage.grid.conflictBadgeSingular', {
                          count: conflicts.length,
                        })
                      : t('organizer.schedulePage.grid.conflictBadgePlural', {
                          count: conflicts.length,
                        })}
                  </span>
                )}
                {hallFilterControl}
                <div className="ml-auto flex items-center gap-1 text-muted">
                  <span className="text-[11px] font-medium">
                    {t('organizer.schedulePage.grid.zoomLabel')}
                  </span>
                  <button
                    type="button"
                    aria-label={t('organizer.schedulePage.grid.zoomOut')}
                    onClick={() => setSlotHeightPx((h) => zoomToSlotHeight(h - 4))}
                    className="rounded border border-border px-1.5 leading-none hover:bg-background"
                  >
                    −
                  </button>
                  <button
                    type="button"
                    aria-label={t('organizer.schedulePage.grid.zoomIn')}
                    onClick={() => setSlotHeightPx((h) => zoomToSlotHeight(h + 4))}
                    className="rounded border border-border px-1.5 leading-none hover:bg-background"
                  >
                    +
                  </button>
                </div>
              </div>
              <BlockGridView
                lices={visibleLices}
                blocks={dayBlocks}
                breaks={bgvBreaks}
                tournamentColorByName={tournamentColorByName}
                baseDate={activeDay}
                timezone={eventTz}
                gridEndSlot={gridEndSlot}
                gridStartHour={gridStartHour}
                drift={liceDrift}
                nowSlot={nowSlot}
                conflictMatchIds={conflictMatchIds}
                overlapBlockKeys={overlapBlockKeys}
                slotHeightPx={slotHeightPx}
                focusedTournament={focusedTournament}
                onShiftLice={shiftLiceRemaining}
                onEditBlock={setEditingBlock}
                onEditBreak={setEditingBreak}
                onDeleteBlock={unscheduleRunBlock}
                onDeleteBreak={(brk) => void deleteBlock(brk.id)}
                onResizeBlockTime={resizeBlockTimeTo}
                onResizeBreakTime={(brk, newEnd) => void resizeBreakTimeTo(brk, newEnd)}
                onResizeBlockStart={retimeBlockStart}
                onResizeBreakStart={(brk, newStart) => void resizeBreakStartTo(brk, newStart)}
                onResizeBlockLices={changeBlockLices}
                onBlockDragStart={(block) => {
                  dragViewBlock.current = { matchIds: block.matches.map((m) => m.id) };
                  dragMatch.current = null;
                  dragPool.current = null;
                  dragBracketRound.current = null;
                }}
                onBlockDragEnd={() => {
                  dragViewBlock.current = null;
                }}
                onBreakDragStart={(brk) => {
                  dragViewBreak.current = { id: brk.id, startTime: brk.startTime };
                  dragViewBlock.current = null;
                  dragMatch.current = null;
                  dragPool.current = null;
                  dragBracketRound.current = null;
                }}
                onBreakDragEnd={() => {
                  dragViewBreak.current = null;
                }}
                onDropOnLice={handleBlockViewDrop}
                onCreateAtCell={(slot) =>
                  setCreatingBreak(
                    newBreakDraftFromCell(slot, t('organizer.schedulePage.grid.breakDefaultLabel')),
                  )
                }
                dragOverLiceId={dragOverLiceId}
                onDragOverLice={setDragOverLiceId}
              />
            </>
          ) : (
            <>
              {/* Same hall filter the Blocks view shows — it used to live inside
                that view's fragment only, so switching here hid the control
                while `venueFilter` stayed set. */}
              <div className="mb-2 flex flex-wrap items-center gap-2">{hallFilterControl}</div>
              <div
                className="relative grid w-full"
                style={{
                  gridTemplateColumns: `${TIME_LABEL_COL_PX}px repeat(${visibleLices.length}, minmax(${MIN_LICE_COL_PX}px, 1fr))`,
                  gridAutoRows: `${SLOT_HEIGHT_PX}px`,
                }}
              >
                {/* Row 1: venue header band. Consecutive same-venue lice
                  columns share one header cell; lices without a venue
                  show "No venue". The cell is clickable when bound to a
                  venue — opens the event's Venues tab so the operator
                  can edit the venue inline. */}
                <div
                  className="sticky top-0 z-30 bg-surface border-b border-border"
                  style={{ gridColumn: 1, gridRow: 1, height: VENUE_HEADER_HEIGHT_PX }}
                />
                {computeVenueGroups(visibleLices).map((group, groupIndex) => {
                  const startCol = group.startIndex + 2;
                  if (group.venueId) {
                    const tint = venueColor(group.venueId);
                    return (
                      <a
                        key={`${group.venueId}-${groupIndex}`}
                        href={`/org/${slug}/venues`}
                        className="sticky top-0 z-30 border-b border-l border-l-border px-2 flex items-center justify-center text-sm font-semibold truncate hover:brightness-95"
                        style={{
                          gridColumn: `${startCol} / span ${group.span}`,
                          gridRow: 1,
                          height: VENUE_HEADER_HEIGHT_PX,
                          ...(tint ?? {}),
                        }}
                        title={group.venueName ?? ''}
                      >
                        {group.venueName}
                      </a>
                    );
                  }
                  return (
                    <div
                      key={`no-venue-${groupIndex}`}
                      className="sticky top-0 z-30 bg-border border-b border-border border-l border-l-border px-2 flex items-center justify-center text-sm italic text-muted truncate"
                      style={{
                        gridColumn: `${startCol} / span ${group.span}`,
                        gridRow: 1,
                        height: VENUE_HEADER_HEIGHT_PX,
                      }}
                    >
                      {t('organizer.schedulePage.blockGrid.noVenue')}
                    </div>
                  );
                })}

                {/* Row 2: lice header — corner cell + lice name cells. Every
                  cell is explicitly placed so the per-slot Fragment below
                  can't be cascaded out of position by the absolutely-placed
                  match cards (see Slice 1 of the schedule overhaul plan).
                  Sticky `top` matches the venue band's height so this row
                  parks directly under it on scroll. */}
                <div
                  className="sticky bg-surface border-b border-border"
                  style={{ gridColumn: 1, gridRow: 2, top: VENUE_HEADER_HEIGHT_PX, zIndex: 20 }}
                />
                {visibleLices.map((lice, liceIndex) => (
                  <div
                    key={lice.id}
                    className="sticky bg-surface border-b border-border border-l border-l-border px-2 flex items-center justify-center gap-1"
                    style={{
                      gridColumn: liceIndex + 2,
                      gridRow: 2,
                      top: VENUE_HEADER_HEIGHT_PX,
                      zIndex: 20,
                      height: LICE_HEADER_HEIGHT_PX,
                    }}
                  >
                    <span className="text-xs font-bold text-foreground-secondary truncate">
                      {lice.name}
                    </span>
                    {/* The only way to place a lice after the event wizard has
                      run — PATCH /lices/:id had no caller before this. */}
                    <button
                      type="button"
                      onClick={() => setPlacingLice(lice)}
                      title={t('organizer.schedulePage.placement.editLabel')}
                      aria-label={t('organizer.schedulePage.placement.editLabel')}
                      className="shrink-0 text-xs text-muted hover:text-accent focus:outline-none focus:ring-2 focus:ring-accent rounded"
                    >
                      ⌖
                    </button>
                  </div>
                ))}

                {/* Rows 2..gridEndSlot+1: time-label cell + one drop-target cell per lice.
                  Every cell is explicitly placed via gridColumn/gridRow so that
                  match cards (which are also explicitly placed below) can't
                  cascade auto-flow rightward. Dropping a fight at e.g. 09:10 in
                  lice 2 used to push the 10:00 label out of col 1 — see the
                  schedule overhaul plan, Slice 1. */}
                {Array.from({ length: gridEndSlot }, (_, slot) => (
                  <Fragment key={slot}>
                    {/* Time label — sticky left, explicit (col 1, row slot+2) */}
                    <div
                      className="sticky left-0 z-10 bg-surface text-xs text-muted pr-1 flex items-center justify-end select-none"
                      style={{
                        gridColumn: 1,
                        gridRow: rowFor(slot),
                        borderTop: slot % 12 === 0 ? '1px solid #d1d5db' : '1px solid transparent',
                      }}
                    >
                      {slot % 12 === 0 ? formatSlotTime(slot, gridStartHour) : ''}
                    </div>

                    {/* Drop-target cells — one per lice, explicit column index */}
                    {visibleLices.map((lice, liceIndex) => {
                      const isHover =
                        dragOverCell?.liceId === lice.id && dragOverCell?.slot === slot;
                      return (
                        <div
                          key={lice.id}
                          // The drop target's identity, readable from the DOM.
                          // These cells are unlabelled siblings of the match
                          // cards, positioned only by inline grid coordinates,
                          // so a test had no way to name "the 14:00 cell on
                          // piste 2" except by reproducing rowFor() — which
                          // would break the moment the axis geometry moved.
                          // See tests/drag/schedule-grid.spec.ts.
                          data-lice-id={lice.id}
                          data-slot={slot}
                          className={[
                            'border-l border-l-border transition-colors relative',
                            isHover
                              ? 'bg-blue-100 ring-2 ring-inset ring-blue-400'
                              : 'bg-background',
                          ].join(' ')}
                          style={{
                            gridColumn: liceIndex + 2,
                            gridRow: rowFor(slot),
                            borderTop:
                              slot % 12 === 0 ? '1px solid #d1d5db' : '1px solid transparent',
                          }}
                          onDragOver={(e) => {
                            e.preventDefault();
                            if (dragOverCell?.liceId !== lice.id || dragOverCell?.slot !== slot) {
                              setDragOverCell({ liceId: lice.id, slot });
                            }
                          }}
                          onDragLeave={() => {
                            if (dragOverCell?.liceId === lice.id && dragOverCell?.slot === slot) {
                              setDragOverCell(null);
                            }
                          }}
                          onDrop={() => {
                            setDragOverCell(null);
                            handleDrop(lice.id, slot);
                          }}
                        >
                          {isHover && (
                            <span className="pointer-events-none absolute left-1 top-1 z-20 rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white shadow">
                              {formatSlotTime(slot, gridStartHour)} · {lice.name}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </Fragment>
                ))}

                {/* Scheduled match cards on the active day — positioned by grid cell. */}
                {scheduledOnActiveDay.map((m) => {
                  // visibleLices, not lices: the column index must agree with the
                  // header and drop-target loops above, or a hall filter would place
                  // cards in the wrong column instead of hiding them.
                  const liceIndex = visibleLices.findIndex((l) => l.id === m.liceId);
                  if (liceIndex === -1) return null;
                  const slot = isoToSlotTz(m.scheduledAt!, activeDay);
                  const span = Math.max(1, Math.floor(m.durationMinutes / SLOT_MINUTES));
                  const hasConflict = conflicts.some(
                    (c) => c.matchA === m.matchNumberLabel || c.matchB === m.matchNumberLabel,
                  );
                  // Card tints by the parent tournament's color so the
                  // grid reads as a horizontal flow of tournaments. The
                  // existing round code text (LSW-P1-…, LSW-B-QF-…)
                  // signals pool-vs-bracket; conflicts override with
                  // red-200 so they stay the dominant signal.
                  return (
                    // eslint-disable-next-line jsx-a11y/click-events-have-key-events -- draggable match card; onClick is a modifier-gated (ctrl/meta) shortcut, not the primary affordance
                    <div
                      key={m.id}
                      draggable
                      onDragStart={() => {
                        dragMatch.current = m;
                      }}
                      onClick={(e) => {
                        if (!(e.ctrlKey || e.metaKey)) return;
                        e.preventDefault();
                        openMatchScoring(slug, eventId, m.id);
                      }}
                      className={[
                        'rounded text-xs font-medium px-1 flex items-center cursor-grab active:cursor-grabbing overflow-hidden z-10 border',
                        hasConflict
                          ? 'bg-danger/10 border-danger/30 text-danger'
                          : `${tintBgClassFor(m.tournamentColor)} ${tintBorderClassFor(m.tournamentColor)} ${tintTextClassFor(m.tournamentColor)}`,
                        saving === m.id ? 'opacity-50' : '',
                      ].join(' ')}
                      style={{
                        gridColumn: liceIndex + 2, // +1 for time-label col, +1 for 1-based
                        gridRow: `${rowFor(slot)} / span ${span}`, // base slot+3 (venue+lice+1-based) plus reserved pool-header rows
                        margin: '1px',
                      }}
                      title={`${m.roundCode || m.matchNumberLabel} · ${t('organizer.schedulePage.grid.ctrlClickHint')}${m.tournamentName ? ` · ${m.tournamentName}` : ''}${m.poolName ? ` · ${m.poolName}` : ''}: ${t('organizer.schedulePage.grid.versus', { a: m.redFighterName ?? '?', b: m.blueFighterName ?? '?' })}`}
                    >
                      <span className="truncate">{m.roundCode || m.matchNumberLabel}</span>
                    </div>
                  );
                })}

                {/* Run headers: one tinted band + bold strip per contiguous
                  same-pool / same-bracket-round run on a lice ("Pool 1",
                  "Semi-finals", …). Separating a match splits the run, so
                  each cluster keeps its own header. The band uses dashed
                  colored borders to read as a container; matches inside
                  keep their own solid styling and stay above the band via
                  z-index so the operator can still drag individual cards
                  out of the run. */}
                {headerRunsOnActiveDay.map((group) => {
                  // The header occupies its own reserved rows ABOVE the run's
                  // first match (matchRowStart already includes this run's
                  // shift). The band wraps header + matches.
                  const matchRowStart = rowFor(group.startSlot);
                  const headerRowStart = matchRowStart - POOL_HEADER_SPAN;
                  const bandRowEnd = rowFor(group.endSlot);
                  return (
                    <Fragment key={group.key}>
                      {/* Translucent band — purely decorative, pointer-events
                        none so individual match drags inside the band still
                        work. */}
                      <div
                        aria-hidden="true"
                        className={[
                          'pointer-events-none rounded-md border-2 border-dashed',
                          tintBgClassFor(group.tournamentColor),
                          tintBorderClassFor(group.tournamentColor),
                        ].join(' ')}
                        style={{
                          gridColumn: group.liceIndex + 2,
                          gridRow: `${headerRowStart} / ${bandRowEnd}`,
                          margin: '1px',
                          opacity: 0.45,
                          zIndex: 5,
                        }}
                      />
                      {/* Drag handle: bold header strip the operator drags to
                        move this run's matches. Reuses the dragBracketRound
                        payload (a plain matchIds group) so handleDrop's
                        existing handleGroupDrop path re-fans the run at the
                        drop target — works for pools and rounds alike. */}
                      <div
                        draggable
                        role="button"
                        tabIndex={0}
                        onDragStart={() => {
                          dragBracketRound.current = {
                            key: group.key,
                            matchIds: group.matchIds,
                          };
                          dragMatch.current = null;
                          dragPool.current = null;
                          dragBlock.current = null;
                        }}
                        onDragEnd={() => {
                          dragBracketRound.current = null;
                        }}
                        onClick={() => setPendingRunClear(group)}
                        onKeyDown={(ev) => {
                          if (ev.key === 'Enter' || ev.key === ' ') {
                            ev.preventDefault();
                            setPendingRunClear(group);
                          }
                        }}
                        title={`${group.label}${group.tournamentName ? ` - ${group.tournamentName}` : ''} ${
                          group.matchCount === 1
                            ? t('organizer.schedulePage.grid.runHeaderHintSingular', {
                                count: group.matchCount,
                              })
                            : t('organizer.schedulePage.grid.runHeaderHintPlural', {
                                count: group.matchCount,
                              })
                        }`}
                        className={[
                          'flex items-center justify-between gap-1 rounded-t-md border border-b-0 px-3 py-2 text-sm font-bold shadow-sm cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow',
                          accentClassFor(group.tournamentColor),
                          tintBorderClassFor(group.tournamentColor),
                          'text-white',
                        ].join(' ')}
                        style={{
                          gridColumn: group.liceIndex + 2,
                          // Sits in its own reserved rows just above the run's
                          // first match.
                          gridRow: `${headerRowStart} / ${matchRowStart}`,
                          marginLeft: '1px',
                          marginRight: '1px',
                          zIndex: 12,
                          pointerEvents: 'auto',
                        }}
                      >
                        <span className="truncate">
                          {group.label}
                          {group.tournamentName ? ` - ${group.tournamentName}` : ''}
                        </span>
                        <span className="text-xs opacity-90">· {group.matchCount}</span>
                      </div>
                    </Fragment>
                  );
                })}

                {/* Slice 7 + schedule overhaul slice 5: non-fight programme
                  blocks rendered as full-width bars across every lice
                  column. Now draggable — operator drops the bar on any
                  cell in the target row and the backend cascade-shifts
                  every later match on that day by the same Δ. Striped
                  chrome distinguishes them from fight cards.
                  The bottom-edge resize handle (4px) lets the operator
                  grow / shrink the block in 5-min increments — PATCHes
                  the resize endpoint on pointerup. */}
                {blocksOnActiveDay.map((b) => {
                  const optimisticSpan =
                    resizingBlock?.id === b.id ? resizingBlock.previewSpan : b.span;
                  return (
                    <div
                      key={b.id}
                      draggable
                      onDragStart={() => {
                        dragBlock.current = { id: b.id, startTime: b.startTime };
                        dragMatch.current = null;
                        dragPool.current = null;
                      }}
                      onDragEnd={() => {
                        dragBlock.current = null;
                      }}
                      aria-label={b.label}
                      title={t('organizer.schedulePage.grid.blockBarTitle', {
                        start: b.startTime,
                        end: b.endTime,
                        label: b.label,
                      })}
                      className={[
                        'relative pointer-events-auto flex items-center justify-center overflow-hidden border-y text-[11px] font-semibold uppercase tracking-wide text-foreground-secondary cursor-grab active:cursor-grabbing',
                        movingBlockId === b.id || deletingBlockId === b.id ? 'opacity-50' : '',
                      ].join(' ')}
                      style={{
                        gridColumn: '2 / -1',
                        // Explicit end row (not span) so any reserved pool-header
                        // rows inside the block's range are accounted for.
                        gridRow: `${rowFor(b.startSlot)} / ${rowFor(b.startSlot + optimisticSpan)}`,
                        zIndex: 8,
                        // Same tint as the Blocks view. This used to hardcode
                        // slate/purple by kind, so the colour an operator picked
                        // in the edit popover rendered on one view and vanished
                        // on the other. `resolveBlockAccent` also supplies the
                        // per-kind default, which is what the picker rings.
                        ...blockTint(resolveBlockAccent(b.blockType, b.colorHex ?? null)),
                      }}
                    >
                      <span className="truncate px-2">
                        {b.label} ({b.startTime} – {b.endTime})
                      </span>
                      <button
                        type="button"
                        draggable={false}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          setPendingBlockDelete(b);
                        }}
                        aria-label={t('organizer.schedulePage.blockGrid.deleteAria', {
                          label: b.label,
                        })}
                        title={t('organizer.schedulePage.blockGrid.deleteAria', { label: b.label })}
                        className="absolute right-1 top-1/2 -translate-y-1/2 z-30 rounded p-0.5 text-muted hover:bg-surface hover:text-foreground transition-colors"
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M18 6 6 18" />
                          <path d="m6 6 12 12" />
                        </svg>
                      </button>
                      {/* Bottom-edge resize handle. pointerdown captures the
                      pointer; pointermove updates the previewSpan in
                      5-min increments; pointerup commits via PATCH
                      resize. The `draggable={false}` + stopPropagation
                      keeps the parent's HTML5 drag handler dormant
                      while the operator is resizing. */}
                      <div
                        role="separator"
                        aria-label={t('organizer.schedulePage.blockGrid.resizeAria', {
                          label: b.label,
                        })}
                        draggable={false}
                        onPointerDown={(ev) => beginBlockResize(ev, b)}
                        className="absolute inset-x-0 bottom-0 z-30 h-1 cursor-row-resize bg-transparent hover:bg-muted/40"
                      />
                    </div>
                  );
                })}

                {/* Slice 4: "now" marker — horizontal red line across every
                  lice column at the current time slot. Only rendered when
                  the active day is today (see nowSlot above). */}
                {nowSlot !== null && (
                  <div
                    aria-hidden="true"
                    className="pointer-events-none flex items-center"
                    style={{
                      gridColumn: '1 / -1',
                      gridRow: rowFor(nowSlot),
                      zIndex: 15,
                    }}
                  >
                    <div className="h-[2px] w-full bg-red-600 shadow-[0_0_4px_rgba(220,38,38,0.6)]" />
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Block grid edit popover (name / time / lice span). */}
      {(editingBlock || editingBreak) && (
        <BlockEditPopover
          key={editingBreak ? `brk-${editingBreak.id}` : `blk-${editingBlock?.key ?? ''}`}
          open
          mode={editingBreak ? 'break' : 'block'}
          title={t('organizer.schedulePage.blockGrid.editAria', {
            label: editingBreak ? editingBreak.label : (editingBlock?.label ?? ''),
          })}
          initial={
            editingBreak
              ? {
                  label: editingBreak.label,
                  startHHMM: editingBreak.startTime,
                  endHHMM: editingBreak.endTime,
                  liceIds: [],
                  colorHex: editingBreak.colorHex ?? '',
                }
              : {
                  label: editingBlock?.label ?? '',
                  startHHMM: editingBlock
                    ? slotToHHMM(isoToSlotTz(editingBlock.startIso, activeDay), gridStartHour)
                    : '',
                  endHHMM: editingBlock
                    ? slotToHHMM(isoToSlotTz(editingBlock.endIso, activeDay), gridStartHour)
                    : '',
                  liceIds: editingBlock?.liceIds ?? [],
                  colorHex: '',
                }
          }
          lices={lices}
          defaultColorHex={resolveBlockAccent(
            editingBreak ? editingBreak.kind : 'competition',
            null,
          )}
          busy={blockEditBusy}
          onCancel={() => {
            setEditingBlock(null);
            setEditingBreak(null);
          }}
          onSave={savePopover}
        />
      )}

      {/* Create-break popover (double-click an empty grid cell). */}
      {creatingBreak && (
        <BlockEditPopover
          open
          mode="break"
          title={t('organizer.schedulePage.grid.addBreakTitle')}
          initial={creatingBreak}
          lices={lices}
          // createBreakBlock always POSTs blockType: 'break'.
          defaultColorHex={resolveBlockAccent('break', null)}
          busy={blockEditBusy}
          onCancel={() => setCreatingBreak(null)}
          onSave={(draft) => void createBreakBlock(draft)}
        />
      )}

      {/* Slice 3: Clear-day confirm modal. */}
      <ConfirmDialog
        open={pendingClear}
        onConfirm={() => void clearActiveDay()}
        onCancel={() => setPendingClear(false)}
        title={t('organizer.schedulePage.grid.clearDayTitle')}
        description={t(
          scheduledOnActiveDay.length === 1
            ? 'organizer.schedulePage.grid.clearDayDescSingular'
            : 'organizer.schedulePage.grid.clearDayDescPlural',
          {
            count: scheduledOnActiveDay.length,
            day: activeDay ? formatDayLabel(activeDay) : t('organizer.schedulePage.grid.thisDay'),
          },
        )}
        confirmLabel={t('organizer.schedulePage.grid.clearDayConfirm')}
        danger
        busy={clearingDay}
      />

      {/* Clear-run confirm modal (pool cluster or bracket round). */}
      <ConfirmDialog
        open={pendingRunClear !== null}
        onConfirm={() => pendingRunClear && void clearRun(pendingRunClear)}
        onCancel={() => setPendingRunClear(null)}
        title={
          pendingRunClear
            ? t('organizer.schedulePage.grid.clearRunTitle', { label: pendingRunClear.label })
            : ''
        }
        description={
          pendingRunClear
            ? t(
                pendingRunClear.matchCount === 1
                  ? 'organizer.schedulePage.grid.clearRunDescSingular'
                  : 'organizer.schedulePage.grid.clearRunDescPlural',
                {
                  count: pendingRunClear.matchCount,
                  label: `${pendingRunClear.label}${pendingRunClear.tournamentName ? ` (${pendingRunClear.tournamentName})` : ''}`,
                  day: activeDay
                    ? formatDayLabel(activeDay)
                    : t('organizer.schedulePage.grid.thisDay'),
                },
              )
            : ''
        }
        confirmLabel={t('organizer.schedulePage.grid.clearConfirm')}
        danger
        busy={clearingRun}
      />

      {/* Inline block-delete confirm modal. */}
      <ConfirmDialog
        open={pendingBlockDelete !== null}
        onConfirm={() => pendingBlockDelete && void deleteBlock(pendingBlockDelete.id)}
        onCancel={() => setPendingBlockDelete(null)}
        title={
          pendingBlockDelete
            ? t('organizer.schedulePage.grid.deleteBlockTitle', {
                label: pendingBlockDelete.label,
              })
            : ''
        }
        description={
          pendingBlockDelete
            ? t('organizer.schedulePage.grid.deleteBlockDesc', {
                type:
                  pendingBlockDelete.blockType === 'break'
                    ? t('organizer.schedulePage.grid.blockTypeBreak')
                    : t('organizer.schedulePage.grid.blockTypeAdmin'),
                start: pendingBlockDelete.startTime,
                end: pendingBlockDelete.endTime,
              })
            : ''
        }
        confirmLabel={t('organizer.schedulePage.grid.deleteBlockConfirm')}
        danger
        busy={deletingBlockId !== null}
      />

      {/* Undo toast — surfaces after an inline × unschedule / block delete. */}
      {lastUndo && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 left-1/2 z-overlay flex -translate-x-1/2 items-center gap-3 rounded-lg bg-strong px-4 py-2.5 text-sm text-strong-foreground shadow-lg"
        >
          <span>
            {lastUndo.kind === 'unschedule'
              ? t(
                  lastUndo.matches.length === 1
                    ? 'organizer.schedulePage.grid.undoUnscheduledSingular'
                    : 'organizer.schedulePage.grid.undoUnscheduledPlural',
                  { count: lastUndo.matches.length, label: lastUndo.label },
                )
              : t('organizer.schedulePage.grid.undoDeleted', { label: lastUndo.label })}
          </span>
          <button
            type="button"
            onClick={() => void performUndo()}
            className="rounded bg-white/15 px-2 py-1 font-semibold text-strong-foreground hover:bg-white/25"
          >
            {t('organizer.schedulePage.grid.undoAction')}
          </button>
          <button
            type="button"
            aria-label={t('organizer.schedulePage.grid.dismiss')}
            onClick={() => setLastUndo(null)}
            className="text-strong-foreground/70 hover:text-strong-foreground"
          >
            ✕
          </button>
        </div>
      )}

      {placingLice && (
        <LicePlacementEditor
          eventId={eventId}
          lice={placingLice}
          onClose={() => setPlacingLice(null)}
          onSaved={refetchLices}
        />
      )}
    </div>
  );
}
