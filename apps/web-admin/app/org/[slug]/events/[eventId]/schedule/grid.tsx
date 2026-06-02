'use client';

/* eslint-disable myclash/no-literal-string */

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { ConfirmDialog } from '@myclash/ui';
import { detectConflicts, type Conflict } from './conflict-detection';
import { buildMatchScoringHref, buildScoringHref } from '../pools/_tabs/build-scoring-href';
import { requireClientEnv } from '../../../../../../src/config/client-env';

// requireClientEnv throws in prod when missing so a forgotten
// Dockerfile ARG can't ship as a silent localhost fallback.
const scoringBaseUrl = requireClientEnv('NEXT_PUBLIC_SCORING_URL', 'http://localhost:3002');

/**
 * Ctrl/⌘-click on a match card (placed grid card OR unscheduled
 * chip) jumps the operator straight into the cross-app scoring
 * pad. Plain click is reserved for drag-and-drop selection.
 */
function openMatchScoring(liceId: string | null, matchId: string): void {
  if (liceId) {
    const href = buildScoringHref(scoringBaseUrl, liceId);
    if (href) window.location.href = href;
    return;
  }
  const href = buildMatchScoringHref(scoringBaseUrl, matchId, window.location.href);
  if (href) window.location.href = href;
}

interface Lice {
  id: string;
  name: string;
  sortOrder: number;
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
  durationMinutes: number;
  phaseType: string | null;
  /** Populated for pool-type matches; drives the per-pool colour tint
   *  on the grid card. Null for bracket / finals matches. */
  poolId: string | null;
  poolName: string | null;
}

/**
 * Slice 5 of the schedule overhaul: stable per-pool palette. Hash the
 * `tournamentName + poolName` key into one of 8 pastel slots so the
 * same pool always renders with the same colour and pools across
 * tournaments don't collide visually.
 *
 * Returned classes are intentionally light (50/200) so the existing
 * conflict (red-200/400) and bracket (amber-100/300) styling still
 * reads through as the dominant signal.
 */
const POOL_PALETTE: Array<{ bg: string; border: string; text: string }> = [
  { bg: 'bg-rose-50', border: 'border-rose-300', text: 'text-rose-900' },
  { bg: 'bg-sky-50', border: 'border-sky-300', text: 'text-sky-900' },
  { bg: 'bg-emerald-50', border: 'border-emerald-300', text: 'text-emerald-900' },
  { bg: 'bg-violet-50', border: 'border-violet-300', text: 'text-violet-900' },
  { bg: 'bg-amber-50', border: 'border-amber-300', text: 'text-amber-900' },
  { bg: 'bg-teal-50', border: 'border-teal-300', text: 'text-teal-900' },
  { bg: 'bg-fuchsia-50', border: 'border-fuchsia-300', text: 'text-fuchsia-900' },
  { bg: 'bg-indigo-50', border: 'border-indigo-300', text: 'text-indigo-900' },
];

function poolColourFor(tournamentName: string | null, poolName: string | null) {
  if (!poolName) return null;
  const key = `${tournamentName ?? ''}|${poolName}`;
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return POOL_PALETTE[Math.abs(hash) % POOL_PALETTE.length]!;
}

const SLOT_MINUTES = 5;
const GRID_START_HOUR = 8;
const GRID_END_HOUR = 20;
const TOTAL_SLOTS = ((GRID_END_HOUR - GRID_START_HOUR) * 60) / SLOT_MINUTES;
const SLOT_HEIGHT_PX = 16;
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

export function ScheduleGrid({ eventId }: { slug: string; eventId: string }) {
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

  const [lices, setLices] = useState<Lice[]>([]);
  const [matches, setMatches] = useState<ScheduleMatch[]>([]);
  const [days, setDays] = useState<string[]>([]);
  const [activeDay, setActiveDay] = useState<string>('');
  const [loading, setLoading] = useState(true);
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
        if (licesRes.ok) {
          const l = (await licesRes.json()) as Lice[];
          setLices(l.sort((a, b) => a.sortOrder - b.sortOrder));
        }
        if (schedRes.ok) {
          const m = (await schedRes.json()) as ScheduleMatch[];
          setMatches(m);
          setConflicts(detectConflicts(m));
        }
        if (eventRes.ok) {
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
        }
        if (programmeRes.ok) {
          // Slice 7: fetch every programme block; we keep the admin /
          // break entries to render as full-width bars on the grid
          // (registration, gear check, referee meeting, breaks).
          // Competition / workshop blocks are skipped — fights and
          // workshops are already rendered by the matches projection.
          const blocks = (await programmeRes.json()) as ProgrammeBlockRow[];
          setProgrammeBlocks(
            blocks.filter((b) => b.blockType === 'admin' || b.blockType === 'break'),
          );
        }
      })
      .catch((err: unknown) => {
        setLoading(false);
        if (err instanceof Error && err.name === 'AbortError') return;
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

  function handleDrop(liceId: string, slot: number) {
    // Pool-block drop takes precedence — same cell, different payload.
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
    const updated = matches.map((m) =>
      m.id === match.id ? { ...m, liceId, scheduledAt: newScheduledAt } : m,
    );
    setMatches(updated);
    setConflicts(detectConflicts(updated));
    void saveMatchPosition(match.id, liceId, newScheduledAt);
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
    minSlot: number;
    minLiceIndex: number;
    matchCount: number;
  };
  const poolGroupsOnActiveDay = useMemo<PoolGroup[]>(() => {
    if (!activeDay) return [];
    const byPool = new Map<string, PoolGroup>();
    for (const m of scheduledOnActiveDay) {
      if (!m.poolId || !m.poolName) continue;
      const liceIndex = lices.findIndex((l) => l.id === m.liceId);
      if (liceIndex === -1) continue;
      const slot = isoToSlot(m.scheduledAt!, activeDay);
      const existing = byPool.get(m.poolId);
      if (!existing) {
        byPool.set(m.poolId, {
          poolId: m.poolId,
          poolName: m.poolName,
          tournamentName: m.tournamentName,
          minSlot: slot,
          minLiceIndex: liceIndex,
          matchCount: 1,
        });
      } else {
        existing.matchCount += 1;
        if (slot < existing.minSlot) {
          existing.minSlot = slot;
          existing.minLiceIndex = liceIndex;
        }
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
              {/* Row 1: header — corner cell + lice name cells. Every cell is
                  explicitly placed so the per-slot Fragment below can't be
                  cascaded out of position by the absolutely-placed match
                  cards (see Slice 1 of the schedule overhaul plan). */}
              <div
                className="sticky top-0 z-20 bg-white border-b border-gray-300"
                style={{ gridColumn: 1, gridRow: 1 }}
              />
              {lices.map((lice, liceIndex) => (
                <div
                  key={lice.id}
                  className="sticky top-0 z-20 bg-white border-b border-gray-300 border-l border-l-gray-200 px-2 flex items-center"
                  style={{ gridColumn: liceIndex + 2, gridRow: 1, height: SLOT_HEIGHT_PX * 2 }}
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
                      gridRow: slot + 2,
                      borderTop: slot % 12 === 0 ? '1px solid #d1d5db' : '1px solid transparent',
                    }}
                  >
                    {slot % 12 === 0 ? formatSlotTime(slot) : ''}
                  </div>

                  {/* Drop-target cells — one per lice, explicit column index */}
                  {lices.map((lice, liceIndex) => (
                    <div
                      key={lice.id}
                      className="bg-gray-50 border-l border-l-gray-200"
                      style={{
                        gridColumn: liceIndex + 2,
                        gridRow: slot + 2,
                        borderTop: slot % 12 === 0 ? '1px solid #d1d5db' : '1px solid transparent',
                      }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => handleDrop(lice.id, slot)}
                    />
                  ))}
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
                const isBracket = m.phaseType !== null && m.phaseType !== 'pool';
                // Slice 5: per-pool colour. Falls back to the legacy
                // blue palette for pool matches that somehow lack a
                // poolName (defensive — backend now always projects it).
                const poolPalette =
                  !isBracket && m.poolName ? poolColourFor(m.tournamentName, m.poolName) : null;
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
                      openMatchScoring(m.liceId, m.id);
                    }}
                    className={[
                      'rounded text-xs font-medium px-1 flex items-center cursor-grab active:cursor-grabbing overflow-hidden z-10 border',
                      hasConflict
                        ? 'bg-red-200 border-red-400 text-red-800'
                        : isBracket
                          ? 'bg-amber-100 border-amber-300 text-amber-800'
                          : poolPalette
                            ? `${poolPalette.bg} ${poolPalette.border} ${poolPalette.text}`
                            : 'bg-blue-100 border-blue-300 text-blue-800',
                      saving === m.id ? 'opacity-50' : '',
                    ].join(' ')}
                    style={{
                      gridColumn: liceIndex + 2, // +1 for time-label col, +1 for 1-based
                      gridRow: `${slot + 2} / span ${span}`, // +1 for header row, +1 for 1-based
                      margin: '1px',
                    }}
                    title={`${m.roundCode || m.matchNumberLabel} · Ctrl/⌘-click to open scoring${m.tournamentName ? ` · ${m.tournamentName}` : ''}${m.poolName ? ` · ${m.poolName}` : ''}: ${m.redFighterName ?? '?'} vs ${m.blueFighterName ?? '?'}`}
                  >
                    <span className="truncate">{m.roundCode || m.matchNumberLabel}</span>
                  </div>
                );
              })}

              {/* Slice 6: per-pool handle. Anchored to the topmost match
                  of each pool group on the active day. Clicking the
                  handle opens the confirm modal for clearing the pool. */}
              {poolGroupsOnActiveDay.map((group) => {
                const palette = poolColourFor(group.tournamentName, group.poolName);
                return (
                  <button
                    key={group.poolId}
                    type="button"
                    onClick={() => setPendingPoolClear(group)}
                    title={`${group.poolName} (${group.matchCount} match${group.matchCount === 1 ? '' : 'es'}) — click to clear the pool`}
                    className={[
                      'absolute -translate-y-full self-start rounded-t-md px-1.5 py-0.5 text-[10px] font-bold leading-none shadow-sm border border-b-0 hover:shadow-md transition-shadow',
                      palette
                        ? `${palette.bg} ${palette.border} ${palette.text}`
                        : 'bg-blue-100 border-blue-300 text-blue-800',
                    ].join(' ')}
                    style={{
                      gridColumn: group.minLiceIndex + 2,
                      gridRow: group.minSlot + 2,
                      zIndex: 12,
                      pointerEvents: 'auto',
                    }}
                  >
                    {group.poolName} · {group.matchCount}
                  </button>
                );
              })}

              {/* Slice 7: non-fight programme blocks rendered as full-width
                  bars across every lice column. Read-only for now — drag
                  support stays a follow-up. Striped chrome distinguishes
                  them from fight cards. */}
              {blocksOnActiveDay.map((b) => (
                <div
                  key={b.id}
                  aria-label={b.label}
                  title={`${b.startTime} – ${b.endTime} · ${b.label}`}
                  className={[
                    'pointer-events-auto flex items-center justify-center overflow-hidden text-[11px] font-semibold uppercase tracking-wide',
                    b.blockType === 'break'
                      ? 'bg-slate-100 text-slate-600 border-y border-slate-300'
                      : 'bg-purple-50 text-purple-800 border-y border-purple-300',
                  ].join(' ')}
                  style={{
                    gridColumn: '2 / -1',
                    gridRow: `${b.startSlot + 2} / span ${b.span}`,
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
                </div>
              ))}

              {/* Slice 4: "now" marker — horizontal red line across every
                  lice column at the current time slot. Only rendered when
                  the active day is today (see nowSlot above). */}
              {nowSlot !== null && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none flex items-center"
                  style={{
                    gridColumn: '1 / -1',
                    gridRow: nowSlot + 2,
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
    </div>
  );
}

function MatchChip({
  match,
  saving,
  onDragStart,
}: {
  match: ScheduleMatch;
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
        openMatchScoring(match.liceId, match.id);
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
