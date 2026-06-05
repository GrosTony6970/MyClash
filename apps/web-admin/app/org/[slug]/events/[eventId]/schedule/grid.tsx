'use client';

/* eslint-disable myclash/no-literal-string */

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  ConfirmDialog,
  accentClassFor,
  tintBgClassFor,
  tintBorderClassFor,
  tintTextClassFor,
} from '@myclash/ui';
import { placeWithShift } from './place-with-shift';
import { detectConflicts, type Conflict } from './conflict-detection';
import { buildMatchScoringHref } from '../pools/_tabs/build-scoring-href';

/**
 * Ctrl/⌘-click on a match card (placed grid card OR unscheduled
 * chip) opens the same-origin proxied scoring view for **that
 * specific match**. Plain click is reserved for drag-and-drop
 * selection. The scoring route works for both pool and bracket
 * matches without needing lice/phase branching.
 *
 * `externalDisplay` carries the admin's read-only scoreboard URL so
 * the operator can throw the projection on a second monitor in one
 * click. Same-origin via Traefik `/scoring/*` avoids the dev-cert
 * prompt that blocks cross-origin scoring.myclash.fr.
 */
function openMatchScoring(slug: string, eventId: string, matchId: string): void {
  const scoreboardHref = `/org/${slug}/events/${eventId}/matches/${matchId}/scoreboard`;
  const href = buildMatchScoringHref('/scoring', matchId, window.location.href, scoreboardHref);
  if (href) window.location.href = href;
}

interface Lice {
  id: string;
  name: string;
  sortOrder: number;
  /**
   * Slice 8 of the venues feature: when a lice is attached to an
   * org-level venue, the schedule grid groups consecutive same-venue
   * lice columns under a single venue header row. Backend projects
   * this via `venues(id, name)` on /events/:eventId/lices.
   */
  venues?: { id: string; name: string } | null;
}

interface VenueGroup {
  venueId: string | null;
  venueName: string | null;
  startIndex: number;
  span: number;
}

/**
 * Group consecutive same-venue lice columns into header bands. Lice
 * with no venue render under a "No venue" header at their position
 * (we don't reorder — sortOrder still wins) so the operator's column
 * layout stays predictable.
 */
function computeVenueGroups(lices: Lice[]): VenueGroup[] {
  const groups: VenueGroup[] = [];
  for (let i = 0; i < lices.length; i++) {
    const lice = lices[i]!;
    const id = lice.venues?.id ?? null;
    const name = lice.venues?.name ?? null;
    const previous = groups[groups.length - 1];
    if (previous && previous.venueId === id) {
      previous.span += 1;
    } else {
      groups.push({ venueId: id, venueName: name, startIndex: i, span: 1 });
    }
  }
  return groups;
}

/**
 * Slice 7: non-fight programme blocks rendered on the grid.
 * `dayIndex` indexes into the event's `days` array (computed below from
 * the event start/end). `startTime` / `endTime` are HH:MM strings on
 * that day. Currently read-only — drag-to-move stays a follow-up.
 */
interface ProgrammeBlockRow {
  id: string;
  dayIndex: number;
  blockType: 'admin' | 'competition' | 'workshop' | 'break';
  label: string;
  startTime: string;
  endTime: string;
}

interface ScheduleMatch {
  id: string;
  matchNumberLabel: string;
  /** Canonical match code (LSW-P1-ML1-PA-M1 for pools, LSW-B-QF-M1 for brackets).
   *  Backend computes it via formatRoundCode; the sidebar + grid use it as the
   *  display label, falling back to matchNumberLabel for legacy payloads. */
  roundCode?: string;
  status: string;
  liceId: string | null;
  scheduledAt: string | null;
  redFighterName: string | null;
  blueFighterName: string | null;
  redRegistrationId: string;
  blueRegistrationId: string;
  tournamentName: string | null;
  /** Parent tournament's identity color (ColorToken string). Drives
   *  the card tint so every card from the same tournament reads as
   *  one family. Null falls back to the default token via the tint
   *  helpers in @myclash/ui. */
  tournamentColor: string | null;
  durationMinutes: number;
  phaseType: string | null;
  /** Populated for pool-type matches; drives the per-pool colour tint
   *  on the grid card. Null for bracket / finals matches. */
  poolId: string | null;
  poolName: string | null;
}

const SLOT_MINUTES = 5;
const GRID_START_HOUR = 8;
const GRID_END_HOUR = 20;
const TOTAL_SLOTS = ((GRID_END_HOUR - GRID_START_HOUR) * 60) / SLOT_MINUTES;
const SLOT_HEIGHT_PX = 16;
// Header rows are taller than body rows so the venue + lice names
// read clearly. The lice header's sticky `top` offset must equal
// VENUE_HEADER_HEIGHT_PX so it sticks below the venue band instead
// of sliding under it on scroll.
const VENUE_HEADER_HEIGHT_PX = 40;
const LICE_HEADER_HEIGHT_PX = 40;
const TIME_LABEL_COL_PX = 64;
const MIN_LICE_COL_PX = 140;

function minutesToSlot(minutes: number): number {
  return Math.floor(minutes / SLOT_MINUTES);
}

function slotToTime(slot: number, baseDate: string): string {
  const base = new Date(baseDate);
  base.setHours(GRID_START_HOUR, 0, 0, 0);
  base.setMinutes(base.getMinutes() + slot * SLOT_MINUTES);
  return base.toISOString();
}

function isoToSlot(iso: string, baseDate: string): number {
  const base = new Date(baseDate);
  base.setHours(GRID_START_HOUR, 0, 0, 0);
  const diff = (new Date(iso).getTime() - base.getTime()) / 60_000;
  return Math.max(0, minutesToSlot(diff));
}

function formatSlotTime(slot: number): string {
  const totalMin = GRID_START_HOUR * 60 + slot * SLOT_MINUTES;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Return every ISO date (YYYY-MM-DD) between start and end inclusive.
 * Falls back to [start] when end is missing or earlier than start.
 */
function eachDay(start: string, end: string | null | undefined): string[] {
  if (!start) return [];
  if (!end || end < start) return [start];
  const days: string[] = [];
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  for (let d = new Date(startDate); d <= endDate; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(d.toISOString().slice(0, 10));
  }
  return days.length > 0 ? days : [start];
}

/** Day-of-week + DD MMM, French locale (the rest of the admin app is FR-leaning). */
function formatDayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('fr-FR', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  });
}

/** True when `scheduledAtIso` falls on the same calendar day (UTC) as `dayIso`. */
function matchBelongsToDay(scheduledAtIso: string | null, dayIso: string): boolean {
  if (!scheduledAtIso) return false;
  return scheduledAtIso.slice(0, 10) === dayIso;
}

export function ScheduleGrid({
  slug,
  eventId,
  onProgrammeMutated,
}: {
  slug: string;
  eventId: string;
  /**
   * Fired after a programme-block mutation that the Configure drawer
   * should refetch (block delete from the inline ×, block drag-move
   * cascade). Symmetric to ProgrammePlanner's onBlocksChanged →
   * gridRefreshKey nonce; the page bumps a `programmeRefreshKey`
   * nonce here and threads it to the planner so it re-runs its
   * mount fetch.
   */
  onProgrammeMutated?: () => void;
}) {
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

  const [lices, setLices] = useState<Lice[]>([]);
  const [matches, setMatches] = useState<ScheduleMatch[]>([]);
  const [days, setDays] = useState<string[]>([]);
  const [activeDay, setActiveDay] = useState<string>('');
  const [loading, setLoading] = useState(true);
  // When any of the schedule-page bootstrap fetches errors out (or
  // returns a non-2xx body), surface it as a banner above the grid.
  // Before this, a 400 like the dead `tournaments.bracket_size`
  // SELECT was silently swallowed — the grid just stayed empty and
  // the operator had to dig into DevTools to find the cause.
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  // Slice 7: non-fight programme blocks (registration, gear check,
  // referee meeting, breaks) rendered as full-width bars on the grid.
  const [programmeBlocks, setProgrammeBlocks] = useState<ProgrammeBlockRow[]>([]);
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
  undoStackRef.current = undoStack;
  redoStackRef.current = redoStack;

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
      setAddLiceError('Name required');
      return;
    }
    setAddLiceBusy(true);
    setAddLiceError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/lices`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          colorHex: newLiceColor,
          sortOrder: lices.length,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? 'Failed to add lice');
      }
      await refetchLices();
      setNewLiceName('');
      setShowAddLice(false);
    } catch (err) {
      setAddLiceError(err instanceof Error ? err.message : 'Failed to add lice');
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
          setFetchError(`Lices: ${await bodyMessage(licesRes)}`);
          return;
        }
        if (!schedRes.ok) {
          setFetchError(`Schedule: ${await bodyMessage(schedRes)}`);
          return;
        }
        if (!eventRes.ok) {
          setFetchError(`Event: ${await bodyMessage(eventRes)}`);
          return;
        }
        if (!programmeRes.ok) {
          setFetchError(`Programme: ${await bodyMessage(programmeRes)}`);
          return;
        }
        setFetchError(null);
        const l = (await licesRes.json()) as Lice[];
        setLices(l.sort((a, b) => a.sortOrder - b.sortOrder));
        const m = (await schedRes.json()) as ScheduleMatch[];
        setMatches(m);
        setConflicts(detectConflicts(m));
        // GET /api/v1/events/:id resolves to `getEventBySlug` which returns
        // the raw Supabase row — snake_case fields. Don't paper over it
        // with `startDate` aliases unless the API mapping is unified.
        const ev = (await eventRes.json()) as {
          start_date: string;
          end_date?: string | null;
        };
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
        setFetchError(err instanceof Error ? err.message : 'Schedule failed to load');
      });
    return () => controller.abort();
  }, [eventId, apiUrl]);

  async function saveMatchPosition(matchId: string, liceId: string, scheduledAt: string) {
    setSaving(matchId);
    try {
      await fetch(`${apiUrl}/api/v1/matches/${matchId}/schedule`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ liceId, scheduledAt }),
      });
    } finally {
      setSaving(null);
    }
  }

  async function refetchScheduleAndBlocks(): Promise<void> {
    const [schedRes, programmeRes] = await Promise.all([
      fetch(`${apiUrl}/api/v1/events/${eventId}/schedule`, { credentials: 'include' }),
      fetch(`${apiUrl}/api/v1/events/${eventId}/programme`, { credentials: 'include' }),
    ]);
    if (schedRes.ok) {
      const m = (await schedRes.json()) as ScheduleMatch[];
      setMatches(m);
      setConflicts(detectConflicts(m));
    }
    if (programmeRes.ok) {
      const blocks = (await programmeRes.json()) as ProgrammeBlockRow[];
      setProgrammeBlocks(blocks.filter((b) => b.blockType === 'admin' || b.blockType === 'break'));
    }
  }

  async function moveBlockTo(blockId: string, slot: number): Promise<void> {
    setMovingBlockId(blockId);
    try {
      // The grid axis runs 08:00–20:00 in 5-min steps. Translate the
      // drop slot back to HH:MM the backend expects.
      const newStartMin = GRID_START_HOUR * 60 + slot * SLOT_MINUTES;
      const hh = Math.floor(newStartMin / 60);
      const mm = newStartMin % 60;
      const newStartTime = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
      const res = await fetch(
        `${apiUrl}/api/v1/events/${eventId}/programme/blocks/${blockId}/move`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newStartTime }),
        },
      );
      if (!res.ok) return;
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
      const nextSpan = Math.max(1, Math.min(TOTAL_SLOTS - block.startSlot, startSpan + deltaSlots));
      setResizingBlock((prev) =>
        prev && prev.id === block.id ? { ...prev, previewSpan: nextSpan } : prev,
      );
    }
    async function onUp(e: PointerEvent) {
      handle.releasePointerCapture(e.pointerId);
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onCancel);
      // Compute new end_time from final preview span.
      const finalSpan = Math.round((e.clientY - startY) / SLOT_HEIGHT_PX) + startSpan;
      const clampedSpan = Math.max(1, Math.min(TOTAL_SLOTS - block.startSlot, finalSpan));
      setResizingBlock(null);
      if (clampedSpan === startSpan) return;
      const newEndMinutes = GRID_START_HOUR * 60 + (block.startSlot + clampedSpan) * SLOT_MINUTES;
      const hh = String(Math.floor(newEndMinutes / 60)).padStart(2, '0');
      const mm = String(newEndMinutes % 60).padStart(2, '0');
      const newEndTime = `${hh}:${mm}`;
      try {
        const res = await fetch(
          `${apiUrl}/api/v1/events/${eventId}/programme/blocks/${block.id}/resize`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ newEndTime }),
          },
        );
        if (!res.ok) return;
        await refetchScheduleAndBlocks();
        onProgrammeMutated?.();
      } catch {
        // Surfaces on next refetch; refetch handles consistency.
      }
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
    setDeletingBlockId(blockId);
    try {
      const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/programme/blocks/${blockId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) return;
      await refetchScheduleAndBlocks();
      onProgrammeMutated?.();
    } finally {
      setDeletingBlockId(null);
      setPendingBlockDelete(null);
    }
  }

  function handleDrop(liceId: string, slot: number) {
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
    const match = dragMatch.current;
    if (!match || !activeDay) return;
    const newScheduledAt = slotToTime(slot, activeDay);
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
        slot: isoToSlot(m.scheduledAt!, activeDay),
        span: Math.max(1, Math.floor(m.durationMinutes / SLOT_MINUTES)),
      }));
    const placement = placeWithShift({
      items: occupants,
      dropped: { id: match.id, slot, span },
      dropSlot: slot,
      gridEndSlot: TOTAL_SLOTS,
    });
    const shiftedById = new Map(placement.shifted.map((s) => [s.id, s.slot]));
    const updated = matches.map((m) => {
      if (m.id === match.id) return { ...m, liceId, scheduledAt: newScheduledAt };
      const newSlot = shiftedById.get(m.id);
      if (newSlot == null) return m;
      return { ...m, scheduledAt: slotToTime(newSlot, activeDay) };
    });
    setMatches(updated);
    setConflicts(detectConflicts(updated));
    void saveMatchPosition(match.id, liceId, newScheduledAt);
    // Fan-out PATCHes for every neighbour the shift moved. Fire-and-
    // forget; refetch on next render keeps state honest.
    for (const s of placement.shifted) {
      const moved = matches.find((m) => m.id === s.id);
      if (!moved) continue;
      void saveMatchPosition(s.id, liceId, slotToTime(s.slot, activeDay));
    }
    dragMatch.current = null;
  }

  /**
   * Pool drop: fan every match in the pool across the event's lices
   * starting at (slot, liceId). Defaults to 5-minute slots (matching
   * the grid resolution) and fills every lice in the event from the
   * drop target onward.
   */
  async function handlePoolDrop(poolId: string, startLiceId: string, slot: number) {
    if (!activeDay) return;
    setAutoDistributeError(null);
    const startAtIso = slotToTime(slot, activeDay);
    try {
      const res = await fetch(`${apiUrl}/api/v1/pools/${poolId}/schedule/auto-distribute`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startAtIso,
          startLiceId,
          durationMinutes: 5,
          parallelLices: lices.length,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as {
        updated: Array<{ matchId: string; liceId: string; scheduledAt: string }>;
      };
      // Apply optimistically against current matches.
      const byMatchId = new Map(data.updated.map((u) => [u.matchId, u]));
      const updated = matches.map((m) => {
        const u = byMatchId.get(m.id);
        if (!u) return m;
        return { ...m, liceId: u.liceId, scheduledAt: u.scheduledAt };
      });
      setMatches(updated);
      setConflicts(detectConflicts(updated));
    } catch (err) {
      setAutoDistributeError(err instanceof Error ? err.message : 'Auto-distribute failed');
    }
  }

  function pushUndo(move: ScheduleMove) {
    setUndoStack((prev) => [...prev, move].slice(-20));
    setRedoStack([]);
  }

  async function applyMove(matchId: string, liceId: string | null, scheduledAt: string | null) {
    const updated = matches.map((m) => (m.id === matchId ? { ...m, liceId, scheduledAt } : m));
    setMatches(updated);
    setConflicts(detectConflicts(updated));
    await saveMatchPosition(matchId, liceId ?? '', scheduledAt ?? '');
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
      await Promise.all(
        targets.map((m) =>
          fetch(`${apiUrl}/api/v1/matches/${m.id}/schedule`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ liceId: null, scheduledAt: null }),
          }),
        ),
      );
      const targetIds = new Set(targets.map((m) => m.id));
      const updated = matches.map((m) =>
        targetIds.has(m.id) ? { ...m, liceId: null, scheduledAt: null } : m,
      );
      setMatches(updated);
      setConflicts(detectConflicts(updated));
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

  const scheduledOnActiveDay = useMemo(
    () =>
      matches.filter(
        (m) => m.scheduledAt && m.liceId && matchBelongsToDay(m.scheduledAt, activeDay),
      ),
    [matches, activeDay],
  );

  // Slice 6: group active-day matches by pool so the operator can
  // clear an entire pool's day in one click. Each group also exposes
  // the topmost slot/lice it occupies so the handle can be anchored to
  // the right cell in the grid.
  type PoolGroup = {
    poolId: string;
    poolName: string;
    tournamentName: string | null;
    tournamentColor: string | null;
    minSlot: number;
    /** Exclusive end slot — last match's slot + its span. The band's
     *  bottom edge sits here so it visually wraps every pool match. */
    endSlot: number;
    minLiceIndex: number;
    matchCount: number;
    /** All match IDs in this pool group, in scheduled-time order.
     *  Powers the drag-by-name payload (same shape as the unscheduled
     *  pool-tile drag at line 1076). */
    matchIds: string[];
  };
  const poolGroupsOnActiveDay = useMemo<PoolGroup[]>(() => {
    if (!activeDay) return [];
    const byPool = new Map<string, PoolGroup>();
    for (const m of scheduledOnActiveDay) {
      if (!m.poolId || !m.poolName) continue;
      const liceIndex = lices.findIndex((l) => l.id === m.liceId);
      if (liceIndex === -1) continue;
      const slot = isoToSlot(m.scheduledAt!, activeDay);
      const span = Math.max(1, Math.floor(m.durationMinutes / SLOT_MINUTES));
      const endSlot = slot + span;
      const existing = byPool.get(m.poolId);
      if (!existing) {
        byPool.set(m.poolId, {
          poolId: m.poolId,
          poolName: m.poolName,
          tournamentName: m.tournamentName,
          tournamentColor: m.tournamentColor,
          minSlot: slot,
          endSlot,
          minLiceIndex: liceIndex,
          matchCount: 1,
          matchIds: [m.id],
        });
      } else {
        existing.matchCount += 1;
        existing.matchIds.push(m.id);
        if (slot < existing.minSlot) {
          existing.minSlot = slot;
          existing.minLiceIndex = liceIndex;
        }
        if (endSlot > existing.endSlot) existing.endSlot = endSlot;
      }
    }
    return Array.from(byPool.values());
  }, [scheduledOnActiveDay, lices, activeDay]);

  const [pendingPoolClear, setPendingPoolClear] = useState<PoolGroup | null>(null);
  const [clearingPool, setClearingPool] = useState(false);

  async function clearPool(group: PoolGroup) {
    if (!activeDay) return;
    setClearingPool(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/pools/${group.poolId}/schedule?day=${activeDay}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Optimistic local state update: null out matching matches.
      const updated = matches.map((m) =>
        m.poolId === group.poolId && m.scheduledAt && matchBelongsToDay(m.scheduledAt, activeDay)
          ? { ...m, liceId: null, scheduledAt: null }
          : m,
      );
      setMatches(updated);
      setConflicts(detectConflicts(updated));
    } finally {
      setClearingPool(false);
      setPendingPoolClear(null);
    }
  }

  // Slice 7: programme blocks (admin / break) scoped to the active day,
  // with their start/end converted into grid slot indices for rendering.
  const blocksOnActiveDay = useMemo(() => {
    if (!activeDay) return [] as Array<ProgrammeBlockRow & { startSlot: number; span: number }>;
    const dayIndex = days.indexOf(activeDay);
    if (dayIndex < 0) return [];
    return programmeBlocks
      .filter((b) => b.dayIndex === dayIndex)
      .map((b) => {
        const [sh, sm] = b.startTime.split(':').map((s) => Number(s));
        const [eh, em] = b.endTime.split(':').map((s) => Number(s));
        const startMin = (sh ?? 0) * 60 + (sm ?? 0) - GRID_START_HOUR * 60;
        const endMin = (eh ?? 0) * 60 + (em ?? 0) - GRID_START_HOUR * 60;
        const startSlot = Math.max(0, Math.floor(startMin / SLOT_MINUTES));
        const endSlot = Math.max(startSlot + 1, Math.ceil(endMin / SLOT_MINUTES));
        return { ...b, startSlot, span: endSlot - startSlot };
      })
      .filter((b) => b.startSlot < TOTAL_SLOTS);
  }, [programmeBlocks, activeDay, days]);

  // Slice 4: slot index for "now" on the active day. Null when the
  // active day isn't today, when the current time is before the grid
  // start, or when it's past the grid end — caller renders nothing in
  // those cases.
  const nowSlot = useMemo<number | null>(() => {
    if (!activeDay) return null;
    const todayIso = now.toISOString().slice(0, 10);
    if (todayIso !== activeDay) return null;
    const start = new Date(activeDay);
    start.setHours(GRID_START_HOUR, 0, 0, 0);
    const slot = minutesToSlot((now.getTime() - start.getTime()) / 60_000);
    if (slot < 0 || slot >= TOTAL_SLOTS) return null;
    return slot;
  }, [activeDay, now]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <span className="w-8 h-8 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
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
                      ? 'border-red-700 bg-red-700 text-white'
                      : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400',
                    single ? 'cursor-default' : '',
                  ].join(' ')}
                >
                  {single ? formatDayLabel(day) : `Jour ${idx + 1} · ${formatDayLabel(day)}`}
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
              title="Undo (Ctrl+Z)"
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              ↶ Undo
            </button>
            <button
              type="button"
              onClick={() => void redo()}
              disabled={redoStack.length === 0}
              title="Redo (Ctrl+Shift+Z)"
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              ↷ Redo
            </button>
            {/* Clear active day — Slice 3. Disables when the active day has
                nothing to clear, opens a confirm modal otherwise. */}
            <button
              type="button"
              onClick={() => setPendingClear(true)}
              disabled={clearingDay || scheduledOnActiveDay.length === 0}
              className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 disabled:hover:bg-transparent"
            >
              Clear day ({scheduledOnActiveDay.length})
            </button>
            {/* Slice C: spawn a new lice. Toggles an inline form below
                the toolbar; submit POSTs to /events/:id/lices and the
                new column appears in the grid live. */}
            <button
              type="button"
              onClick={() => setShowAddLice((v) => !v)}
              className="rounded-md border border-dashed border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-400 hover:bg-slate-50"
            >
              + Add lice
            </button>
          </div>
        </div>
      )}

      {showAddLice && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
          <label className="flex items-center gap-1.5">
            <span className="text-slate-600">Name</span>
            <input
              type="text"
              value={newLiceName}
              onChange={(e) => setNewLiceName(e.target.value)}
              placeholder="Lice 4"
              maxLength={50}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs"
              autoFocus
            />
          </label>
          <label className="flex items-center gap-1.5">
            <span className="text-slate-600">Colour</span>
            <input
              type="color"
              value={newLiceColor}
              onChange={(e) => setNewLiceColor(e.target.value)}
              className="h-7 w-10 cursor-pointer rounded border border-slate-300"
            />
          </label>
          <button
            type="button"
            onClick={() => void addLice()}
            disabled={addLiceBusy || !newLiceName.trim()}
            className="rounded-md bg-slate-800 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-900 disabled:opacity-50"
          >
            {addLiceBusy ? 'Adding…' : 'Add'}
          </button>
          <button
            type="button"
            onClick={() => {
              setShowAddLice(false);
              setNewLiceName('');
              setAddLiceError(null);
            }}
            className="rounded-md border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
          >
            Cancel
          </button>
          {addLiceError && <span className="text-red-700">{addLiceError}</span>}
        </div>
      )}

      {fetchError && (
        <div
          role="alert"
          className="bg-red-50 border border-red-300 rounded-xl px-4 py-3 mb-4 text-sm flex items-start gap-3"
        >
          <span className="font-bold text-red-700">Schedule failed to load:</span>
          <span className="text-red-600">{fetchError}</span>
          <button
            type="button"
            onClick={() => setFetchError(null)}
            className="ml-auto text-red-700 hover:text-red-900 font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {autoDistributeError && (
        <div className="bg-red-50 border border-red-300 rounded-xl px-4 py-3 mb-4 text-sm flex items-start gap-3">
          <span className="font-bold text-red-700">Auto-distribute failed:</span>
          <span className="text-red-600">{autoDistributeError}</span>
          <button
            type="button"
            onClick={() => setAutoDistributeError(null)}
            className="ml-auto text-red-700 hover:text-red-900 font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {conflicts.length > 0 && (
        <div className="bg-red-50 border border-red-300 rounded-xl px-4 py-3 mb-6 text-sm">
          <p className="font-bold text-red-700 mb-1">
            ⚠ {conflicts.length} scheduling conflict{conflicts.length !== 1 ? 's' : ''}
          </p>
          <ul className="list-disc list-inside text-red-600 space-y-0.5">
            {conflicts.map((c, i) => (
              <li key={i}>
                <strong>{c.personName}</strong> is in both <em>{c.matchA}</em> and{' '}
                <em>{c.matchB}</em> at {c.time}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Unscheduled sidebar — global across all days. */}
        <div className="w-full lg:w-56 lg:flex-shrink-0">
          <h2 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">
            Unscheduled ({unscheduled.length})
          </h2>
          <div
            className="flex flex-col gap-1.5 min-h-[100px] border-2 border-dashed border-gray-200 rounded-xl p-2 max-h-[60vh] overflow-y-auto"
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              // Dropping a pool block back onto the sidebar = no-op.
              if (dragPool.current) {
                dragPool.current = null;
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
              setConflicts(detectConflicts(updated));
              void saveMatchPosition(match.id, '', '');
              dragMatch.current = null;
            }}
          >
            {unscheduled.length === 0 ? (
              <p className="px-1 py-2 text-xs italic text-gray-400">
                All matches placed on the grid.
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
                      }}
                      onDragEnd={() => {
                        dragPool.current = null;
                      }}
                      className="cursor-grab rounded-md border-2 border-dashed border-slate-400 bg-slate-100 px-2 py-1.5 text-xs hover:border-slate-500 hover:bg-slate-200"
                      title={`Drag onto a cell to auto-distribute ${pool.matchIds.length} matches across lices`}
                    >
                      <div className="font-bold text-slate-800 truncate">{pool.poolName}</div>
                      <div className="text-[10px] text-slate-600 truncate">
                        {pool.tournamentName ?? ''} · {pool.matchIds.length} matches
                      </div>
                    </div>
                  ))}
                {unscheduled
                  .filter((m) => !matchIdsCoveredByPoolBlock.has(m.id))
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
                      }}
                    />
                  ))}
              </>
            )}
          </div>
        </div>

        {/* Day grid — lice as columns, time as rows. Columns flex to fill the canvas. */}
        <div className="flex-1 min-w-0 overflow-x-auto">
          {lices.length === 0 ? (
            <p className="text-gray-400 text-sm">No Lices configured for this event.</p>
          ) : !activeDay ? (
            <p className="text-gray-400 text-sm">No event date available.</p>
          ) : (
            <div
              className="relative grid w-full"
              style={{
                gridTemplateColumns: `${TIME_LABEL_COL_PX}px repeat(${lices.length}, minmax(${MIN_LICE_COL_PX}px, 1fr))`,
                gridAutoRows: `${SLOT_HEIGHT_PX}px`,
              }}
            >
              {/* Row 1: venue header band. Consecutive same-venue lice
                  columns share one header cell; lices without a venue
                  show "No venue". The cell is clickable when bound to a
                  venue — opens the event's Venues tab so the operator
                  can edit the venue inline. */}
              <div
                className="sticky top-0 z-30 bg-white border-b border-gray-200"
                style={{ gridColumn: 1, gridRow: 1, height: VENUE_HEADER_HEIGHT_PX }}
              />
              {computeVenueGroups(lices).map((group, groupIndex) => {
                const startCol = group.startIndex + 2;
                if (group.venueId) {
                  return (
                    <a
                      key={`${group.venueId}-${groupIndex}`}
                      href={`/org/${slug}/events/${eventId}/venues`}
                      className="sticky top-0 z-30 bg-blue-50 border-b border-blue-200 border-l border-l-gray-200 px-2 flex items-center justify-center text-sm font-semibold text-blue-800 hover:bg-blue-100 truncate"
                      style={{
                        gridColumn: `${startCol} / span ${group.span}`,
                        gridRow: 1,
                        height: VENUE_HEADER_HEIGHT_PX,
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
                    className="sticky top-0 z-30 bg-gray-100 border-b border-gray-200 border-l border-l-gray-200 px-2 flex items-center justify-center text-sm italic text-gray-400 truncate"
                    style={{
                      gridColumn: `${startCol} / span ${group.span}`,
                      gridRow: 1,
                      height: VENUE_HEADER_HEIGHT_PX,
                    }}
                  >
                    No venue
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
                className="sticky bg-white border-b border-gray-300"
                style={{ gridColumn: 1, gridRow: 2, top: VENUE_HEADER_HEIGHT_PX, zIndex: 20 }}
              />
              {lices.map((lice, liceIndex) => (
                <div
                  key={lice.id}
                  className="sticky bg-white border-b border-gray-300 border-l border-l-gray-200 px-2 flex items-center justify-center"
                  style={{
                    gridColumn: liceIndex + 2,
                    gridRow: 2,
                    top: VENUE_HEADER_HEIGHT_PX,
                    zIndex: 20,
                    height: LICE_HEADER_HEIGHT_PX,
                  }}
                >
                  <span className="text-xs font-bold text-gray-700 truncate">{lice.name}</span>
                </div>
              ))}

              {/* Rows 2..TOTAL_SLOTS+1: time-label cell + one drop-target cell per lice.
                  Every cell is explicitly placed via gridColumn/gridRow so that
                  match cards (which are also explicitly placed below) can't
                  cascade auto-flow rightward. Dropping a fight at e.g. 09:10 in
                  lice 2 used to push the 10:00 label out of col 1 — see the
                  schedule overhaul plan, Slice 1. */}
              {Array.from({ length: TOTAL_SLOTS }, (_, slot) => (
                <Fragment key={slot}>
                  {/* Time label — sticky left, explicit (col 1, row slot+2) */}
                  <div
                    className="sticky left-0 z-10 bg-white text-xs text-gray-400 pr-1 flex items-center justify-end select-none"
                    style={{
                      gridColumn: 1,
                      gridRow: slot + 3,
                      borderTop: slot % 12 === 0 ? '1px solid #d1d5db' : '1px solid transparent',
                    }}
                  >
                    {slot % 12 === 0 ? formatSlotTime(slot) : ''}
                  </div>

                  {/* Drop-target cells — one per lice, explicit column index */}
                  {lices.map((lice, liceIndex) => {
                    const isHover = dragOverCell?.liceId === lice.id && dragOverCell?.slot === slot;
                    return (
                      <div
                        key={lice.id}
                        className={[
                          'border-l border-l-gray-200 transition-colors relative',
                          isHover ? 'bg-blue-100 ring-2 ring-inset ring-blue-400' : 'bg-gray-50',
                        ].join(' ')}
                        style={{
                          gridColumn: liceIndex + 2,
                          gridRow: slot + 3,
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
                            {formatSlotTime(slot)} · {lice.name}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </Fragment>
              ))}

              {/* Scheduled match cards on the active day — positioned by grid cell. */}
              {scheduledOnActiveDay.map((m) => {
                const liceIndex = lices.findIndex((l) => l.id === m.liceId);
                if (liceIndex === -1) return null;
                const slot = isoToSlot(m.scheduledAt!, activeDay);
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
                        ? 'bg-red-200 border-red-400 text-red-800'
                        : `${tintBgClassFor(m.tournamentColor)} ${tintBorderClassFor(m.tournamentColor)} ${tintTextClassFor(m.tournamentColor)}`,
                      saving === m.id ? 'opacity-50' : '',
                    ].join(' ')}
                    style={{
                      gridColumn: liceIndex + 2, // +1 for time-label col, +1 for 1-based
                      gridRow: `${slot + 3} / span ${span}`, // +1 for venue band, +1 for lice header, +1 for 1-based
                      margin: '1px',
                    }}
                    title={`${m.roundCode || m.matchNumberLabel} · Ctrl/⌘-click to open scoring${m.tournamentName ? ` · ${m.tournamentName}` : ''}${m.poolName ? ` · ${m.poolName}` : ''}: ${m.redFighterName ?? '?'} vs ${m.blueFighterName ?? '?'}`}
                  >
                    <span className="truncate">{m.roundCode || m.matchNumberLabel}</span>
                  </div>
                );
              })}

              {/* Pool block: tinted band wrapping every match in the
                  pool on the active day, plus a prominent draggable
                  header strip at the top. The band uses dashed colored
                  borders to read as a container; matches inside keep
                  their own solid styling and stay above the band via
                  z-index so the operator can still drag individual
                  cards out of the pool. */}
              {poolGroupsOnActiveDay.map((group) => {
                const bandRowStart = group.minSlot + 3;
                const bandRowEnd = group.endSlot + 3;
                const headerRowEnd = Math.min(bandRowEnd, bandRowStart + 1);
                return (
                  <Fragment key={group.poolId}>
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
                        gridColumn: group.minLiceIndex + 2,
                        gridRow: `${bandRowStart} / ${bandRowEnd}`,
                        margin: '1px',
                        opacity: 0.45,
                        zIndex: 5,
                      }}
                    />
                    {/* Drag handle: bold header strip the operator drags
                        to move the whole pool. Reuses the same
                        dragPool payload shape as the unscheduled-pool
                        tile, so the existing handleDrop / handlePoolDrop
                        paths work unchanged. */}
                    <div
                      draggable
                      role="button"
                      tabIndex={0}
                      onDragStart={() => {
                        dragPool.current = {
                          poolId: group.poolId,
                          matchIds: group.matchIds,
                        };
                        dragMatch.current = null;
                        dragBlock.current = null;
                      }}
                      onDragEnd={() => {
                        dragPool.current = null;
                      }}
                      onClick={() => setPendingPoolClear(group)}
                      onKeyDown={(ev) => {
                        if (ev.key === 'Enter' || ev.key === ' ') {
                          ev.preventDefault();
                          setPendingPoolClear(group);
                        }
                      }}
                      title={`${group.poolName} (${group.matchCount} match${group.matchCount === 1 ? '' : 'es'}) — drag to move the pool · click to clear`}
                      className={[
                        'flex items-center justify-between gap-1 rounded-t-md border border-b-0 px-2 py-1 text-xs font-bold shadow-sm cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow',
                        accentClassFor(group.tournamentColor),
                        tintBorderClassFor(group.tournamentColor),
                        'text-white',
                      ].join(' ')}
                      style={{
                        gridColumn: group.minLiceIndex + 2,
                        gridRow: `${bandRowStart} / ${headerRowEnd}`,
                        marginLeft: '1px',
                        marginRight: '1px',
                        zIndex: 12,
                        pointerEvents: 'auto',
                      }}
                    >
                      <span className="truncate">{group.poolName}</span>
                      <span className="text-[10px] opacity-90">· {group.matchCount}</span>
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
                    title={`${b.startTime} – ${b.endTime} · ${b.label} · drag to move (cascade-shifts later matches)`}
                    className={[
                      'relative pointer-events-auto flex items-center justify-center overflow-hidden text-[11px] font-semibold uppercase tracking-wide cursor-grab active:cursor-grabbing',
                      b.blockType === 'break'
                        ? 'bg-slate-100 text-slate-600 border-y border-slate-300'
                        : 'bg-purple-50 text-purple-800 border-y border-purple-300',
                      movingBlockId === b.id || deletingBlockId === b.id ? 'opacity-50' : '',
                    ].join(' ')}
                    style={{
                      gridColumn: '2 / -1',
                      gridRow: `${b.startSlot + 3} / span ${optimisticSpan}`,
                      zIndex: 8,
                      backgroundImage:
                        b.blockType === 'break'
                          ? 'repeating-linear-gradient(45deg, transparent, transparent 8px, rgba(100,116,139,0.08) 8px, rgba(100,116,139,0.08) 16px)'
                          : 'repeating-linear-gradient(45deg, transparent, transparent 8px, rgba(147,51,234,0.08) 8px, rgba(147,51,234,0.08) 16px)',
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
                      aria-label={`Delete ${b.label}`}
                      title={`Delete ${b.label}`}
                      className="absolute right-1 top-1/2 -translate-y-1/2 z-30 rounded p-0.5 text-slate-500 hover:bg-white hover:text-slate-900 transition-colors"
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
                      aria-label={`Resize ${b.label}`}
                      draggable={false}
                      onPointerDown={(ev) => beginBlockResize(ev, b)}
                      className="absolute inset-x-0 bottom-0 z-30 h-1 cursor-row-resize bg-transparent hover:bg-slate-500/40"
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
                    gridRow: nowSlot + 3,
                    zIndex: 15,
                  }}
                >
                  <div className="h-[2px] w-full bg-red-600 shadow-[0_0_4px_rgba(220,38,38,0.6)]" />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Slice 3: Clear-day confirm modal. */}
      <ConfirmDialog
        open={pendingClear}
        onConfirm={() => void clearActiveDay()}
        onCancel={() => setPendingClear(false)}
        title="Clear day?"
        description={`This will unschedule ${scheduledOnActiveDay.length} match${
          scheduledOnActiveDay.length === 1 ? '' : 'es'
        } on ${activeDay ? formatDayLabel(activeDay) : 'this day'} and move them back to the Unscheduled list. Matches on other days are not affected.`}
        confirmLabel="Clear day"
        danger
        busy={clearingDay}
      />

      {/* Slice 6: Clear-pool confirm modal. */}
      <ConfirmDialog
        open={pendingPoolClear !== null}
        onConfirm={() => pendingPoolClear && void clearPool(pendingPoolClear)}
        onCancel={() => setPendingPoolClear(null)}
        title={pendingPoolClear ? `Clear ${pendingPoolClear.poolName}?` : ''}
        description={
          pendingPoolClear
            ? `This will unschedule ${pendingPoolClear.matchCount} match${
                pendingPoolClear.matchCount === 1 ? '' : 'es'
              } from ${pendingPoolClear.poolName}${pendingPoolClear.tournamentName ? ` (${pendingPoolClear.tournamentName})` : ''} on ${activeDay ? formatDayLabel(activeDay) : 'this day'}. Matches on other days and from other pools are not affected.`
            : ''
        }
        confirmLabel="Clear pool"
        danger
        busy={clearingPool}
      />

      {/* Inline block-delete confirm modal. */}
      <ConfirmDialog
        open={pendingBlockDelete !== null}
        onConfirm={() => pendingBlockDelete && void deleteBlock(pendingBlockDelete.id)}
        onCancel={() => setPendingBlockDelete(null)}
        title={pendingBlockDelete ? `Delete "${pendingBlockDelete.label}"?` : ''}
        description={
          pendingBlockDelete
            ? `Remove the ${pendingBlockDelete.blockType} block (${pendingBlockDelete.startTime} – ${pendingBlockDelete.endTime}) from the programme. Matches scheduled inside this window will be unscheduled and reappear in the Unscheduled sidebar — matches outside the window keep their existing slot.`
            : ''
        }
        confirmLabel="Delete block"
        danger
        busy={deletingBlockId !== null}
      />
    </div>
  );
}

function MatchChip({
  match,
  slug,
  eventId,
  saving,
  onDragStart,
}: {
  match: ScheduleMatch;
  slug: string;
  eventId: string;
  saving: boolean;
  onDragStart: () => void;
}) {
  const isBracket = match.phaseType !== null && match.phaseType !== 'pool';
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={(e) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        openMatchScoring(slug, eventId, match.id);
      }}
      title={`${match.roundCode || match.matchNumberLabel} · Ctrl/⌘-click to open scoring`}
      className={[
        'border rounded-lg px-2 py-1.5 text-xs cursor-grab active:cursor-grabbing bg-white hover:border-gray-400 transition-colors',
        isBracket ? 'border-amber-300' : 'border-gray-300',
        saving ? 'opacity-50' : '',
      ].join(' ')}
    >
      <div className="flex items-center gap-1">
        <p className="flex-1 font-medium text-gray-900 truncate">
          {match.roundCode || match.matchNumberLabel}
        </p>
        {isBracket && (
          <span className="shrink-0 rounded bg-amber-100 px-1 py-px text-[10px] text-amber-800">
            Bracket
          </span>
        )}
      </div>
      <p className="text-gray-400 truncate">
        {match.redFighterName ?? '?'} vs {match.blueFighterName ?? '?'}
      </p>
    </div>
  );
}
