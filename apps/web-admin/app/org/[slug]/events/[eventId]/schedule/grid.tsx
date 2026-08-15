'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import { ConfirmDialog, accentClassFor } from '@myclash/ui';
import { localeToBcp47 } from '@myclash/time';
import { resolveBlockAccent } from '@myclash/types';
import { placeMultiWithShift } from './place-with-shift';
import { computeHeaderRuns, type HeaderRunItem } from './compute-header-runs';
import { POOL_HEADER_SPAN, rowShiftForSlot } from './pool-header-layout';
import { UnscheduledPanel } from './UnscheduledPanel';
import { RefereeConflictBanner } from './RefereeConflictBanner';
import { useScheduleUndo, type DeletedBlock, type MatchPosition } from './useScheduleUndo';
import { DetailedGridView } from './DetailedGridView';
import { draggedMatchIds, type DragPayload } from './drag-payload';
import type {
  HeaderRunGroup,
  Lice,
  ProgrammeBlockRow,
  ScheduleMatch,
  UnscheduledBracketRound,
  UnscheduledPool,
} from './schedule-types';
import { blockLiceChange, liceSelectionChanged, runUnschedulePlan } from './block-run-plans';
import { newBreakDraftFromCell } from './new-break-draft';
import { hhmmToMinutes, programmeBlocksForDay } from './programme-block-slots';
import { clampPanelWidth } from './panel-width';
import { useSchedulePrefs } from './useSchedulePrefs';
import { useScheduleWrites } from './useScheduleWrites';
import { useProgrammeBars } from './useProgrammeBars';
import { createBarRequest } from './programme-bar-requests';
import {
  barWarningSlotSpan,
  matchSlotSpan,
  respaceBlockSlots,
  retimeBlockSlots,
  type SlotAssignment,
} from './block-geometry';
import { matchBelongsToDay, planMatchDrop } from './plan-match-drop';
import { useScheduleData } from './useScheduleData';
import { BlockGridView, type BgvBreak } from './BlockGridView';
import { BlockEditPopover, type BlockEditDraft } from './BlockEditPopover';
import { computeLiceDrift } from './lice-drift';
import { scheduleToCsv } from './schedule-csv';
import { distributeGroups } from './auto-place';
import { detectScheduleOverlaps } from './detect-overlaps';
import { detectBarCollisions } from './bar-collisions';
import {
  hhmmToSlot,
  isoToSlot,
  nowSlotForDay,
  slotToHHMM,
  slotToTime,
  snapSlot,
  zoomToSlotHeight,
  parseBracketRound,
  formatDayLabel,
  buildScheduleBlocks,
  type ScheduleBlock,
  computeGridEndSlot,
  computeGridStartHour,
} from '@myclash/schedule-core';
import { getPublicApiUrl } from '@/lib/api-url';
import { LicePlacementEditor } from './LicePlacementEditor';
import { mutateSchedule } from './schedule-mutations';

// `computeVenueGroups` + the `VenueGroup` type now live in
// ./schedule-grid-geometry (shared with BlockGridView).
//
// `Lice`, `ProgrammeBlockRow` and `ScheduleMatch` now live in
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

  // The read half and the write half each need something from the other: a
  // refused write rolls back by re-reading the server, and the realtime
  // subscription suppresses itself while a write is in flight. Hooks cannot be
  // mutually recursive, so exactly one of those edges goes through a ref. This
  // is that edge, kept here in the composition root rather than inside either
  // hook, where it would look like an implementation detail of one of them.
  const refetchRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const rollback = useCallback(() => refetchRef.current(), []);
  const {
    saving,
    saveError,
    setSaveError,
    isBusy,
    track,
    saveMatchPosition,
    describeSaveError,
    commit,
    commitAll,
  } = useScheduleWrites({ apiUrl, refetch: rollback });

  // Everything the board reads: bootstrap, the two refetchers, realtime, and
  // the conflict derivation. See ./useScheduleData.
  const {
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
    refereeConflicts,
    refereeCrewConflicts,
    refetchLices,
    refetchScheduleAndBlocks,
  } = useScheduleData({ eventId, apiUrl, isBusy });
  // eslint-disable-next-line react-hooks/refs -- render-time mirror closing the read/write cycle described above
  refetchRef.current = refetchScheduleAndBlocks;

  /**
   * The two things undo needs the board to be able to do. Both live here rather
   * than in the history hook because they are transport, and the hook owns
   * ordering, not writes.
   *
   * `applyUndoPositions` writes through `commitAll` even for a single fight. A
   * one-call fan-out reports the server's own message, exactly as `commit`
   * does — the count only enters the wording from two failures up.
   */
  const applyUndoPositions = useCallback(
    async (positions: Array<{ id: string } & MatchPosition>): Promise<boolean> => {
      const byId = new Map(positions.map((p) => [p.id, p]));
      setMatches((prev) =>
        prev.map((m) => {
          const next = byId.get(m.id);
          return next ? { ...m, liceId: next.liceId, scheduledAt: next.scheduledAt } : m;
        }),
      );
      return commitAll(
        positions.map((p) => () => saveMatchPosition(p.id, p.liceId ?? '', p.scheduledAt ?? '')),
      );
    },
    [setMatches, commitAll, saveMatchPosition],
  );
  const recreateDeletedBlock = useCallback(
    async (block: DeletedBlock): Promise<boolean> => {
      // Same request builder the create path uses — see ./programme-bar-requests
      // for why a snapshot with no colour POSTs without the key rather than null.
      const request = createBarRequest({ apiUrl, eventId }, block);
      const ok = await commit(() => mutateSchedule(request.url, request.init));
      if (!ok) return false;
      await refetchScheduleAndBlocks();
      onProgrammeMutated?.();
      return true;
    },
    [apiUrl, eventId, commit, refetchScheduleAndBlocks, onProgrammeMutated],
  );
  const history = useScheduleUndo({
    activeDay,
    applyPositions: applyUndoPositions,
    recreateBlock: recreateDeletedBlock,
  });

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

  // ── Derived geometry ──────────────────────────────────────────────────────
  //
  // Declared here, above every write handler, because three of them read
  // `gridEndSlot`: beginBlockResize, handleDrop and handleGroupDrop.
  //
  // It used to sit ~1000 lines BELOW those three, and that was fine — a closure
  // captures the binding, not the value, and an event handler only runs after
  // the render that initialised it. What is NOT fine is handing `gridEndSlot`
  // to a hook, because the call evaluates its arguments during render: one line
  // of `useScheduleMutations({ gridEndSlot })` above the const throws
  // `ReferenceError: Cannot access 'gridEndSlot' before initialization` and
  // blanks the board. `tsc` reports nothing either way.
  //
  // So the order below is load-bearing, not tidiness: data, then geometry, then
  // the writes that depend on it. Keep new derivations in that band.
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

  /**
   * Which day of the event is on screen, as the index the programme endpoints
   * key by. Negative when there is no active day yet — the same answer the two
   * readers below used to reach by their own `days.indexOf`, one of them behind
   * an extra empty-string guard that `indexOf` already gives for free.
   */
  const activeDayIndex = useMemo(() => days.indexOf(activeDay), [days, activeDay]);

  // Slice 7: programme blocks (admin / break) scoped to the active day,
  // with their start/end converted into grid slot indices for rendering.
  const blocksOnActiveDay = useMemo(() => {
    if (activeDayIndex < 0)
      return [] as Array<ProgrammeBlockRow & { startSlot: number; span: number }>;
    return programmeBlocksForDay(programmeBlocks, activeDayIndex, gridStartHour);
  }, [programmeBlocks, activeDayIndex, gridStartHour]);

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

  /**
   * Every write to a programme bar — break, admin slot, workshop band — plus the
   * state those writes need while they are in flight. See ./useProgrammeBars.
   *
   * This call MUST stay below `gridEndSlot`: a hook call evaluates its arguments
   * during render, and the resize clamp reads it. One line higher throws
   * `Cannot access 'gridEndSlot' before initialization` and blanks the board,
   * with `tsc` clean either way. That is the data → geometry → writes order the
   * band above documents.
   */
  const bars = useProgrammeBars({
    apiUrl,
    eventId,
    dayIndex: activeDayIndex,
    gridStartHour,
    gridEndSlot,
    programmeBlocks,
    commit,
    refetch: refetchScheduleAndBlocks,
    onProgrammeMutated,
    pushUndo: history.push,
  });
  const {
    movingBlockId,
    deletingBlockId,
    pendingBlockDelete,
    setPendingBlockDelete,
    resizingBlock,
    editingBreak,
    setEditingBreak,
    creatingBreak,
    setCreatingBreak,
    blockEditBusy,
    moveBlockTo,
    deleteBlock,
    beginBlockResize,
    saveBreakEdit,
    resizeBreakTimeTo,
    resizeBreakStartTo,
    createBreakBlock,
  } = bars;

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
  /**
   * The one thing being dragged. See ./drag-payload for why there is one slot
   * and not six.
   *
   * Held in a ref rather than state on purpose: a drag payload is read by drop
   * handlers, never rendered, and re-rendering the whole board on dragstart
   * would cost a frame in the middle of a gesture.
   */
  const drag = useRef<DragPayload | null>(null);
  const beginDrag = useCallback((payload: DragPayload) => {
    drag.current = payload;
  }, []);
  const endDrag = useCallback(() => {
    drag.current = null;
  }, []);
  /** Read and consume — a payload is spent by the drop that acts on it. */
  const takeDrag = useCallback((): DragPayload | null => {
    const payload = drag.current;
    drag.current = null;
    return payload;
  }, []);
  // Highlighted drop target while the operator drags. Drives the
  // blue ring on the hovered cell plus a HH:MM · lice-name pill so
  // the operator can aim the drop instead of guessing. Cleared on
  // drop, on cell-leave, and on drag-cancel.
  const [dragOverCell, setDragOverCell] = useState<{ liceId: string; slot: number } | null>(null);
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

  async function addLice() {
    const name = newLiceName.trim();
    if (!name) {
      setAddLiceError(t('admin.common.nameRequired'));
      return;
    }
    setAddLiceBusy(true);
    setAddLiceError(null);
    try {
      // Tracked, not committed: this owns its own error line under the form, and
      // routing it through `commit` would move that message to the save banner.
      // The board still has to count it as busy — it adds a column.
      await track(() =>
        mutateSchedule(`${apiUrl}/api/v1/events/${eventId}/lices`, {
          method: 'POST',
          body: { name, colorHex: newLiceColor, sortOrder: lices.length },
        }),
      );
      await refetchLices();
      setNewLiceName('');
      setShowAddLice(false);
    } catch (err) {
      setAddLiceError(err instanceof Error ? err.message : t('admin.common.addLiceFailed'));
    } finally {
      setAddLiceBusy(false);
    }
  }

  /**
   * Inline × on a pool/bracket/other block: unschedule its matches (they
   * return to the Unscheduled list) and stage an Undo. No confirm dialog —
   * the Undo toast is the safety net for this one-click affordance.
   */
  function unscheduleRunBlock(block: ScheduleBlock): void {
    // Whether this × unschedules at all, and what undo has to remember to
    // reverse it, are decided in ./block-run-plans.
    const plan = runUnschedulePlan({ block, matches });
    if (!plan) return;
    const ids = new Set(plan.matchIds);
    setMatches(matches.map((m) => (ids.has(m.id) ? { ...m, liceId: null, scheduledAt: null } : m)));
    void commitAll(plan.matchIds.map((id) => () => saveMatchPosition(id, '', '')));
    history.push({ kind: 'unschedule', label: plan.label, matches: plan.prior });
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
        span: matchSlotSpan(m.durationMinutes),
      }));

    // 3. Group's drop set, ordered. The .slot field is unused by
    //    placeMultiWithShift (it computes the real positions); the
    //    .span is what determines how much room the group takes.
    const dropped = groupMatches.map((m) => ({
      id: m.id,
      slot: 0,
      span: matchSlotSpan(m.durationMinutes),
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

  /**
   * A drop on one Detailed-view cell.
   *
   * MUST stay below `handleGroupDrop` and `handlePoolDrop`. It is
   * passed to `DetailedGridView` as a prop, so the React Compiler has to capture
   * it into a memoized context — and a forward reference to a hoisted `function`
   * declaration makes it give up on the WHOLE component:
   * `Todo: [PruneHoistedContexts] Rewrite hoisted function references`.
   *
   * The cost is silent. A bailout is not reported by the recommended rule set,
   * it just stops every compiler-backed lint rule from analysing this file — the
   * three `react-hooks/refs` suppressions below turn into "unused directive"
   * warnings, and a genuine ref write during render stops being flagged at all.
   * Verified by probing with a deliberate one.
   *
   * The reference was harmless while this was only called from an inline arrow
   * inside the JSX. Moving the cells into their own component is what made it
   * matter, which is why nothing caught it earlier.
   */
  function handleDrop(liceId: string, slot: number) {
    // Land on the 15-min grid (the axis still renders in 5-min slots).
    slot = snapSlot(slot);
    const payload = takeDrag();
    if (!payload) return;
    switch (payload.kind) {
      // A programme bar spans every lice column, so any cell on the target
      // row is a valid landing and the lice is irrelevant.
      case 'block':
        void moveBlockTo(payload.id, slot);
        return;
      case 'pool':
        void handlePoolDrop(payload.poolId, liceId, slot);
        return;
      case 'bracketRound':
        void handleGroupDrop(new Set(payload.matchIds), liceId, slot);
        return;
      // The Blocks view's own payloads. Only one view is mounted at a time so
      // neither can reach this handler; they are named rather than swept into
      // a `default:` so the next kind added has to be routed here on purpose.
      case 'viewBlock':
      case 'viewBreak':
        return;
      case 'match':
        break;
    }
    const match = payload.match;
    if (!activeDay) return;
    const newScheduledAt = slotToTimeTz(slot, activeDay);
    // Same-cell drop = no-op; don't pollute the undo stack.
    if (match.liceId === liceId && match.scheduledAt === newScheduledAt) return;
    history.push({
      kind: 'move',
      matchId: match.id,
      from: { liceId: match.liceId, scheduledAt: match.scheduledAt },
      to: { liceId, scheduledAt: newScheduledAt },
    });

    // Where the dropped match and every neighbour it displaces end up. The
    // cascade arithmetic is in ./plan-match-drop; only the timezone is ours.
    const plan = planMatchDrop({
      matches,
      dropped: match,
      targetLiceId: liceId,
      slot,
      day: activeDay,
      gridEndSlot,
      slotOf: (iso) => isoToSlotTz(iso, activeDay),
    });
    const placedById = new Map(
      plan.map((p) => [p.id, { liceId: p.liceId, scheduledAt: slotToTimeTz(p.slot, activeDay) }]),
    );
    setMatches(matches.map((m) => ({ ...m, ...(placedById.get(m.id) ?? {}) })));
    // The dropped match and every neighbour the shift displaced are ONE
    // operation to the operator, so they are reported as one: any rejection
    // re-reads the server instead of leaving half the column moved on screen
    // and unmoved in the database.
    void commitAll(
      plan.map((p) => {
        const placed = placedById.get(p.id)!;
        return () => saveMatchPosition(p.id, placed.liceId, placed.scheduledAt);
      }),
    );
  }

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
        if (e.shiftKey) void history.redo();
        else void history.undo();
      } else if (e.key === 'y' || e.key === 'Y') {
        e.preventDefault();
        void history.redo();
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
    const payload = takeDrag();
    setDragOverLiceId(null);
    // A programme bar drag re-times the block (and cascades later blocks) —
    // the lice is irrelevant since these bars are full-width.
    if (payload?.kind === 'viewBreak') {
      void moveBlockTo(payload.id, snapSlot(slot));
      return;
    }
    const ids = draggedMatchIds(payload);
    if (ids.length === 0 || !activeDay) return;

    // Drop at the grid slot the operator released over (snapped to 15 min),
    // re-fanning the run onto the target lice and shifting any occupants.
    void handleGroupDrop(new Set(ids), liceId, snapSlot(slot));
  }

  /**
   * Drop onto the left panel: take one fight back off the board.
   *
   * Only a single fight comes off this way. Dropping a pool, a bracket round or
   * a programme bar here is a no-op — unscheduling a whole group has its own
   * affordance (the run header's inline ×), which stages an Undo.
   */
  function handleUnscheduleDrop(): void {
    const payload = takeDrag();
    if (payload?.kind !== 'match') return;
    const match = payload.match;
    if (match.liceId === null && match.scheduledAt === null) return;
    history.push({
      kind: 'move',
      matchId: match.id,
      from: { liceId: match.liceId, scheduledAt: match.scheduledAt },
      to: { liceId: null, scheduledAt: null },
    });
    setMatches(
      matches.map((m) => (m.id === match.id ? { ...m, liceId: null, scheduledAt: null } : m)),
    );
    void commit(() => saveMatchPosition(match.id, '', ''));
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
    void commitAll(
      future.map((f) => () => saveMatchPosition(f.id, liceId, shifted(f.scheduledAt!))),
    );
  }

  // ── Block grid: edit popover + resize/edit commit handlers ────────────────
  //
  // Only the competition-run half of the popover state lives here. Its bar half
  // (`editingBreak`, `creatingBreak`, `blockEditBusy`) belongs to the writes that
  // set it — see ./useProgrammeBars.
  const [editingBlock, setEditingBlock] = useState<ScheduleBlock | null>(null);

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
    void commitAll(updates.map((u) => () => saveMatchPosition(u.id, u.liceId, u.scheduledAt)));
  }

  // Vertical resize / end edit: respace each lice's sub-run of the block across
  // [start, newEnd] so a multi-lice bracket keeps its parallel layout.
  /** Slot assignments -> the wire shape. The slot maths is in ./block-geometry;
   *  only the timezone resolution belongs to the component. */
  function commitSlots(assignments: SlotAssignment[]): void {
    if (assignments.length === 0) return;
    applyMatchUpdates(
      assignments.map((a) => ({
        id: a.id,
        liceId: a.liceId,
        scheduledAt: slotToTimeTz(a.slot, activeDay),
      })),
    );
  }

  function resizeBlockTimeTo(block: ScheduleBlock, newEndSlot: number) {
    if (!activeDay) return;
    commitSlots(
      respaceBlockSlots({
        matches: block.matches,
        startSlot: isoToSlotTz(block.startIso, activeDay),
        endSlot: newEndSlot,
      }),
    );
  }

  // Shift the whole block (every lice) so it starts at newStartSlot, preserving
  // its internal layout.
  function retimeBlockStart(block: ScheduleBlock, newStartSlot: number) {
    if (!activeDay) return;
    commitSlots(
      retimeBlockSlots({
        matches: block.matches,
        currentStartSlot: isoToSlotTz(block.startIso, activeDay),
        newStartSlot,
        slotOf: (iso) => isoToSlotTz(iso, activeDay),
      }),
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
      // Same reason as `addLice`: this keeps the server's own reason in the
      // auto-distribute banner, because a partial re-fan needs it. Tracked so
      // realtime does not land mid-cascade.
      await track(() =>
        mutateSchedule(`${apiUrl}/api/v1/events/${eventId}/programme/schedule-group`, {
          method: 'POST',
          body: {
            matchIds,
            liceIds,
            startTime: slotToTimeTz(startSlot, activeDay),
            mode,
          },
        }),
      );
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
    // Server re-fan or client relocate — decided in ./block-run-plans.
    const change = blockLiceChange(block, newLiceIds);
    if (!change || !activeDay) return;
    const startSlot = isoToSlotTz(block.startIso, activeDay);
    if (change.mode === 'refan') {
      void (async () => {
        await postScheduleGroup(change.matchIds, change.liceIds, startSlot, 'bracket-branch');
        // No branch on the result: `postScheduleGroup` has already surfaced the
        // server's own reason for a refusal, and the board re-reads either way
        // because a failed re-fan may still have moved rows.
        await refetchScheduleAndBlocks();
      })();
      return;
    }
    void handleGroupDrop(new Set(change.matchIds), change.liceId, startSlot);
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
      // The popover shows no end field for a run, so only the start and the lice
      // selection can have moved. `draft.endHHMM` is carried in and ignored.
      retimeBlockStart(block, hhmmToSlot(draft.startHHMM, gridStartHour));
      if (liceSelectionChanged(block.liceIds, draft.liceIds)) {
        changeBlockLices(block, draft.liceIds);
      }
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
          (m) => isoToSlotTz(m.scheduledAt!, activeDay) + matchSlotSpan(m.durationMinutes),
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
        span: matchSlotSpan(m.durationMinutes),
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
      await commitAll(group.matchIds.map((id) => () => saveMatchPosition(id, '', '')));
    } finally {
      setClearingRun(false);
      setPendingRunClear(null);
    }
  }

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
        span: barWarningSlotSpan(m.durationMinutes),
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
              onClick={() => void history.undo()}
              disabled={!history.canUndo}
              title={t('organizer.schedulePage.grid.undoTitle')}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground-secondary hover:bg-background disabled:opacity-40"
            >
              {t('organizer.schedulePage.grid.undo')}
            </button>
            <button
              type="button"
              onClick={() => void history.redo()}
              disabled={!history.canRedo}
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

      {/* Referees, below the fighter banner: the same question about a
          different body. Two labelled groups — see ./RefereeConflictBanner. */}
      <RefereeConflictBanner
        live={refereeConflicts}
        crew={refereeCrewConflicts}
        eventTz={eventTz}
      />

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
        <UnscheduledPanel
          panelCollapsed={panelCollapsed}
          onToggleCollapsed={() => setPanelCollapsed((v) => !v)}
          panelWidth={panelWidth}
          onBeginResize={beginPanelResize}
          unscheduled={unscheduled}
          unscheduledPools={unscheduledPools}
          unscheduledBracketRounds={unscheduledBracketRounds}
          matchIdsCoveredByPoolBlock={matchIdsCoveredByPoolBlock}
          matchIdsCoveredByBracketRoundBlock={matchIdsCoveredByBracketRoundBlock}
          tickedKeys={tickedKeys}
          onToggleTicked={toggleTicked}
          onScheduleSelected={() => void scheduleSelected()}
          slug={slug}
          eventId={eventId}
          savingMatchId={saving}
          onUnscheduleDrop={handleUnscheduleDrop}
          onDragStart={beginDrag}
          onDragEnd={endDrag}
          configurePanel={configurePanel}
        />

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
                onBlockDragStart={(block) =>
                  beginDrag({ kind: 'viewBlock', matchIds: block.matches.map((m) => m.id) })
                }
                onBlockDragEnd={endDrag}
                onBreakDragStart={(brk) =>
                  beginDrag({ kind: 'viewBreak', id: brk.id, startTime: brk.startTime })
                }
                onBreakDragEnd={endDrag}
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
            <DetailedGridView
              visibleLices={visibleLices}
              hallFilterControl={hallFilterControl}
              gridEndSlot={gridEndSlot}
              gridStartHour={gridStartHour}
              rowFor={rowFor}
              slotOf={(iso) => isoToSlotTz(iso, activeDay)}
              matches={scheduledOnActiveDay}
              conflictMatchIds={conflictMatchIds}
              savingMatchId={saving}
              slug={slug}
              eventId={eventId}
              runGroups={headerRunsOnActiveDay}
              onClearRun={setPendingRunClear}
              bars={blocksOnActiveDay}
              resizingBlock={resizingBlock}
              movingBlockId={movingBlockId}
              deletingBlockId={deletingBlockId}
              onDeleteBar={setPendingBlockDelete}
              onBeginBarResize={beginBlockResize}
              dragOverCell={dragOverCell}
              onDragOverCell={setDragOverCell}
              onDropOnCell={handleDrop}
              onDragStart={beginDrag}
              onDragEnd={endDrag}
              onPlaceLice={setPlacingLice}
              nowSlot={nowSlot}
            />
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

      {/* Undo toast — the third surface onto the one history, offered after the
          two actions that have no other affordance: an inline × unschedule and
          a deleted bar. Its ✕ and its timeout only hide it; the entry stays in
          the history and Ctrl+Z still reaches it. */}
      {history.toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 left-1/2 z-overlay flex -translate-x-1/2 items-center gap-3 rounded-lg bg-strong px-4 py-2.5 text-sm text-strong-foreground shadow-lg"
        >
          <span>
            {history.toast.kind === 'unschedule'
              ? t(
                  history.toast.matches.length === 1
                    ? 'organizer.schedulePage.grid.undoUnscheduledSingular'
                    : 'organizer.schedulePage.grid.undoUnscheduledPlural',
                  { count: history.toast.matches.length, label: history.toast.label },
                )
              : t('organizer.schedulePage.grid.undoDeleted', { label: history.toast.label })}
          </span>
          <button
            type="button"
            onClick={() => void history.undo()}
            className="rounded bg-white/15 px-2 py-1 font-semibold text-strong-foreground hover:bg-white/25"
          >
            {t('organizer.schedulePage.grid.undoAction')}
          </button>
          <button
            type="button"
            aria-label={t('organizer.schedulePage.grid.dismiss')}
            onClick={history.dismissToast}
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
