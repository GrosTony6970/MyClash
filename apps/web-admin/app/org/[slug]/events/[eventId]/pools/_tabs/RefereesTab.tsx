'use client';

/**
 * RefereesTab — per-pool-phase referee assignment view.
 *
 * Built in R3 of the Staffing overhaul. The pool detail page previously
 * had no in-context surface for referee assignment — operators had to
 * click out to /referees#assignments to see who was on which pool. This
 * tab brings the assignment workflow into the pool detail page, scoped
 * to the current tournament's pools.
 *
 * Layout (top → bottom):
 *   1. PoolTimelineGrid — every event pool grouped by start time, with
 *      this tournament's pools highlighted. Lets the operator see
 *      "4 pools at 09:00, break, 4 at 10:30" and reason about parallel
 *      ref availability.
 *   2. Concurrent-pools list — pools (from other tournaments) whose
 *      time window overlaps with any pool in this tournament. Shows
 *      currently-assigned refs so the operator knows who's locked out.
 *   3. Slot cards per tournament pool — current assignment + Assign /
 *      Unassign buttons. Reuses the same backend endpoints the
 *      event-level Assignments tab uses.
 *
 * Data source: the existing
 * `GET /api/v1/events/:eventId/referee-assignment-board` endpoint.
 * Filtered client-side to this tournament's pools.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { t } from '@myclash/i18n';
import { PoolTimelineGrid, type TimelinePool } from './_components/PoolTimelineGrid';
import {
  SwapSuggestionsPanel,
  type SwapSuggestion,
} from '../../referees/_components/SwapSuggestionsPanel';
import { PoolSlotCard } from '../../referees/_components/PoolSlotCard';

interface AssignmentBoardCandidate {
  userId: string;
  personId: string | null;
  displayName: string;
  clubLabel: string | null;
  qualifications: Array<{ role: string; rating: number | null }>;
  workload: number;
}

interface AssignmentBoardRoleSlot {
  slotIndex: number;
  displayName: string | null;
  allowedSkillIds: string[];
  role: string;
  assignment: {
    id: string;
    userId: string;
    personId: string | null;
    displayName: string;
    status: string;
    autoAssigned: boolean;
  } | null;
  missingReasons: string[];
  candidates: {
    recommended: AssignmentBoardCandidate[];
    warning: Array<AssignmentBoardCandidate & { warnings: string[] }>;
    blocked: Array<AssignmentBoardCandidate & { reasons: string[] }>;
  };
}

interface AssignmentBoardPool {
  id: string;
  name: string;
  tournamentId: string;
  tournamentName: string;
  liceId: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  /** Distinguishes real pools from bracket / finals matches surfaced
   *  alongside them. Default 'pool' for backwards compatibility with
   *  any caller that doesn't populate it. */
  kind?: 'pool' | 'bracket' | 'finals';
  members: Array<{
    registrationId: string;
    personId: string;
    personName: string;
    clubLabel?: string | null;
  }>;
  roleSlots: AssignmentBoardRoleSlot[];
}

interface RefereeSkill {
  id: string;
  name: string;
  color: string;
}

interface AssignmentBoard {
  pools: AssignmentBoardPool[];
  unscheduledPools: AssignmentBoardPool[];
  candidates: AssignmentBoardCandidate[];
  locked: boolean;
  /** R4: engine-computed back-to-back swap proposals. */
  swapSuggestions?: SwapSuggestion[];
}

interface Props {
  eventId: string;
  tournamentId: string;
  isReadOnly: boolean;
}

export function RefereesTab({ eventId, tournamentId, isReadOnly }: Props) {
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
  const [board, setBoard] = useState<AssignmentBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState<{
    pool: AssignmentBoardPool;
    slot: AssignmentBoardRoleSlot;
  } | null>(null);
  const [skills, setSkills] = useState<RefereeSkill[]>([]);
  // Lice id → name map. Surfaces a human label on the timeline cards and
  // the per-tournament PoolSlotCards. Silent fallback to nothing when the
  // fetch fails — the consumer renders no extra label, never the UUID.
  const [liceNameById, setLiceNameById] = useState<Map<string, string>>(() => new Map());

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${apiUrl}/api/v1/events/${eventId}/lices`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) return;
        const lices = (await res.json()) as Array<{ id: string; name: string }>;
        const map = new Map<string, string>();
        for (const l of lices) map.set(l.id, l.name);
        setLiceNameById(map);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [apiUrl, eventId]);

  // Load the skills catalog so chips can tint by the skill's own colour
  // and the role label can render the human name instead of the raw id.
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/events/${eventId}/referee-skills`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as RefereeSkill[];
        setSkills(data);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
      });
    return () => controller.abort();
  }, [apiUrl, eventId]);

  const skillNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const skill of skills) if (skill.name) map.set(skill.id, skill.name);
    return map;
  }, [skills]);
  const skillColorById = useMemo(() => {
    const map = new Map<string, string>();
    for (const skill of skills) if (skill.color) map.set(skill.id, skill.color);
    return map;
  }, [skills]);

  const loadBoard = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/referee-assignment-board`, {
          credentials: 'include',
          signal,
        });
        if (!res.ok) {
          throw new Error(t('organizer.poolsPage.refereesLoadFailed'));
        }
        setBoard((await res.json()) as AssignmentBoard);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : t('organizer.poolsPage.refereesLoadFailed'));
      } finally {
        setLoading(false);
      }
    },
    [apiUrl, eventId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadBoard(controller.signal);
    return () => controller.abort();
  }, [loadBoard]);

  const allBoardPools = useMemo(
    () => (board ? [...board.pools, ...board.unscheduledPools] : []),
    [board],
  );

  const tournamentPools = useMemo(
    () =>
      allBoardPools.filter((p) => p.tournamentId === tournamentId && (p.kind ?? 'pool') === 'pool'),
    [allBoardPools, tournamentId],
  );

  const timelinePools = useMemo<TimelinePool[]>(
    () =>
      // Pools only — bracket/finals matches are staffed in the bracket
      // section, so they don't belong on the pool timeline.
      allBoardPools
        .filter((p) => (p.kind ?? 'pool') === 'pool')
        .map((p) => ({
          id: p.id,
          name: p.name,
          tournamentId: p.tournamentId,
          tournamentName: p.tournamentName,
          scheduledStart: p.scheduledStart,
          scheduledEnd: p.scheduledEnd,
          liceName: p.liceId ? (liceNameById.get(p.liceId) ?? null) : null,
          filledSlotCount: p.roleSlots.filter((s) => s.assignment !== null).length,
          totalSlotCount: p.roleSlots.length,
        })),
    [allBoardPools, liceNameById],
  );

  /**
   * Pools (from other tournaments) whose time window overlaps with any
   * pool in this tournament. Used both for the concurrent-pools summary
   * and to flag "busy in concurrent pool" candidates in the picker.
   */
  const concurrentPools = useMemo(() => {
    if (tournamentPools.length === 0) return [] as AssignmentBoardPool[];
    return allBoardPools.filter((other) => {
      if (other.tournamentId === tournamentId) return false;
      if (!other.scheduledStart || !other.scheduledEnd) return false;
      return tournamentPools.some((mine) => {
        if (!mine.scheduledStart || !mine.scheduledEnd) return false;
        const ms = new Date(mine.scheduledStart).getTime();
        const me = new Date(mine.scheduledEnd).getTime();
        const os = new Date(other.scheduledStart!).getTime();
        const oe = new Date(other.scheduledEnd!).getTime();
        return ms < oe && os < me;
      });
    });
  }, [allBoardPools, tournamentPools, tournamentId]);

  /** userIds already assigned to a concurrent pool. */
  const busyConcurrentUserIds = useMemo(() => {
    const set = new Set<string>();
    for (const pool of concurrentPools) {
      for (const slot of pool.roleSlots) {
        if (slot.assignment?.userId) set.add(slot.assignment.userId);
      }
    }
    return set;
  }, [concurrentPools]);

  async function manualAssign(poolId: string, role: string, userId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/referee-assignments`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ poolId, role, userId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? t('organizer.poolsPage.refereesAssignFailed'));
      }
      setBoard((await res.json()) as AssignmentBoard);
      setPicker(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('organizer.poolsPage.refereesAssignFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function unassign(assignmentId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/referee-assignments/${assignmentId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? t('organizer.poolsPage.refereesAssignFailed'));
      }
      await loadBoard();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('organizer.poolsPage.refereesAssignFailed'));
    } finally {
      setBusy(false);
    }
  }

  /**
   * R4: apply a back-to-back swap suggestion. Unassign-then-assign,
   * mirroring the event-level Assignments tab's applySwap. The
   * board's slot list resolves the old assignment id by
   * (poolId, slotIndex).
   */
  async function applySwap(s: SwapSuggestion) {
    if (!board) return;
    const pool = allBoardPools.find((p) => p.id === s.fromPoolId);
    const slot = pool?.roleSlots.find((rs) => rs.slotIndex === s.fromSlotIndex);
    const oldId = slot?.assignment?.id;
    if (!slot) return;
    setBusy(true);
    setError(null);
    try {
      if (oldId) {
        const delRes = await fetch(`${apiUrl}/api/v1/referee-assignments/${oldId}`, {
          method: 'DELETE',
          credentials: 'include',
        });
        if (!delRes.ok) {
          const body = (await delRes.json().catch(() => ({}))) as { message?: string };
          throw new Error(body.message ?? t('organizer.poolsPage.refereesAssignFailed'));
        }
      }
      await manualAssign(s.fromPoolId, slot.role, s.toPersonId);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('organizer.poolsPage.refereesAssignFailed'));
    } finally {
      setBusy(false);
    }
  }

  if (loading && !board) {
    return <p className="text-sm text-gray-400">{t('organizer.poolsPage.refereesLoading')}</p>;
  }
  if (!board || tournamentPools.length === 0) {
    return (
      <div className="rounded-lg border-2 border-dashed border-gray-200 p-8 text-center">
        <p className="text-sm text-gray-400">{t('organizer.poolsPage.refereesEmpty')}</p>
      </div>
    );
  }

  return (
    <section className="space-y-4">
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <PoolTimelineGrid pools={timelinePools} highlightTournamentId={tournamentId} />

      {concurrentPools.length > 0 && <ConcurrentPoolsPanel pools={concurrentPools} />}

      <section className="space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">
          {t('organizer.poolsPage.refereesSlotCardsTitle')}
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {tournamentPools.map((pool) => (
            <PoolSlotCard
              key={pool.id}
              pool={pool}
              liceName={pool.liceId ? (liceNameById.get(pool.liceId) ?? null) : null}
              isReadOnly={isReadOnly || board.locked}
              busy={busy}
              skillNameById={skillNameById}
              skillColorById={skillColorById}
              onAssignClick={(slot) => setPicker({ pool, slot })}
              onUnassign={(assignmentId) => void unassign(assignmentId)}
            />
          ))}
        </div>
      </section>

      {/* R4: back-to-back swap suggestions for the assignments shown
          here. Filters server-output to this tournament's pools — keeps
          the panel relevant to the operator's current context. */}
      <SwapSuggestionsPanel
        suggestions={(board.swapSuggestions ?? []).filter((s) =>
          tournamentPools.some((p) => p.id === s.fromPoolId),
        )}
        isReadOnly={isReadOnly || board.locked}
        busy={busy}
        onApply={(s) => void applySwap(s)}
      />

      {picker && (
        <CandidatePicker
          pool={picker.pool}
          slot={picker.slot}
          busyConcurrentUserIds={busyConcurrentUserIds}
          onAssign={(userId) => void manualAssign(picker.pool.id, picker.slot.role, userId)}
          onCancel={() => setPicker(null)}
        />
      )}
    </section>
  );
}

// ── Subcomponents ─────────────────────────────────────────────────────────────
// PoolSlotCard moved to ../../referees/_components/PoolSlotCard.tsx so the
// event-level Assignments tab's timeslot grid renders the same card.

function ConcurrentPoolsPanel({ pools }: { pools: AssignmentBoardPool[] }) {
  return (
    <section className="rounded-lg border border-amber-200 bg-amber-50/50 p-4">
      <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-amber-800">
        {t('organizer.poolsPage.refereesConcurrentTitle')}
      </h3>
      <p className="mb-3 text-xs text-amber-700">
        {t('organizer.poolsPage.refereesConcurrentBody', { count: pools.length })}
      </p>
      <ul className="space-y-1 text-xs">
        {pools.map((pool) => {
          const assigned = pool.roleSlots
            .filter((s) => s.assignment !== null)
            .map((s) => s.assignment!.displayName);
          return (
            <li key={pool.id} className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-gray-800">
                {pool.tournamentName} · {pool.name}
                {pool.scheduledStart && (
                  <span className="ml-1 text-gray-500">({formatHHMM(pool.scheduledStart)})</span>
                )}
              </span>
              <span className="text-gray-600">
                {assigned.length > 0
                  ? assigned.join(', ')
                  : t('organizer.poolsPage.refereesUnassigned')}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function CandidatePicker({
  pool,
  slot,
  busyConcurrentUserIds,
  onAssign,
  onCancel,
}: {
  pool: AssignmentBoardPool;
  slot: AssignmentBoardRoleSlot;
  busyConcurrentUserIds: Set<string>;
  onAssign: (userId: string) => void;
  onCancel: () => void;
}) {
  // Augment the blocked list with the busy-in-concurrent-pool reason so
  // the operator sees why a recommended-looking candidate isn't available.
  const augmentedBlocked = useMemo(() => {
    const fromBlocked = slot.candidates.blocked.map((c) => ({
      ...c,
      reasons: busyConcurrentUserIds.has(c.userId)
        ? [...c.reasons, 'busy_in_concurrent_pool']
        : c.reasons,
    }));
    // Promote any recommended candidate that's busy concurrently into blocked.
    const promoted = slot.candidates.recommended
      .filter((c) => busyConcurrentUserIds.has(c.userId))
      .map((c) => ({ ...c, reasons: ['busy_in_concurrent_pool'] }));
    return [...promoted, ...fromBlocked];
  }, [slot, busyConcurrentUserIds]);

  const availableRecommended = useMemo(
    () => slot.candidates.recommended.filter((c) => !busyConcurrentUserIds.has(c.userId)),
    [slot, busyConcurrentUserIds],
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-xl rounded-lg bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              {pool.name} - {slot.displayName ?? slot.role}
            </h2>
            <p className="text-sm text-gray-500">{pool.tournamentName}</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-sm text-gray-500 hover:text-gray-800"
          >
            {t('organizer.poolsPage.refereesCancel')}
          </button>
        </div>

        <div className="max-h-96 space-y-3 overflow-y-auto">
          <CandidateGroup
            title={t('organizer.poolsPage.refereesPickerRecommended')}
            candidates={availableRecommended}
            onSelect={(c) => onAssign(c.userId)}
          />
          {augmentedBlocked.length > 0 && (
            <CandidateGroup
              title={t('organizer.poolsPage.refereesPickerBlocked')}
              candidates={augmentedBlocked.map((c) => ({ ...c, blockedReasons: c.reasons }))}
              disabled
            />
          )}
        </div>
      </div>
    </div>
  );
}

function CandidateGroup({
  title,
  candidates,
  onSelect,
  disabled = false,
}: {
  title: string;
  candidates: Array<AssignmentBoardCandidate & { blockedReasons?: string[] }>;
  onSelect?: (candidate: AssignmentBoardCandidate) => void;
  disabled?: boolean;
}) {
  if (candidates.length === 0) return null;
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
        {title} ({candidates.length})
      </p>
      <ul className="space-y-1">
        {candidates.map((c) => (
          <li
            key={c.userId}
            className={[
              'flex items-center justify-between gap-3 rounded border px-3 py-1.5 text-sm',
              disabled
                ? 'border-gray-200 bg-gray-50 text-gray-500'
                : 'border-gray-200 bg-white hover:border-gray-400',
            ].join(' ')}
          >
            <div className="min-w-0">
              <p className="truncate font-medium text-gray-900">{c.displayName}</p>
              {c.clubLabel && <p className="truncate text-[10px] text-gray-400">{c.clubLabel}</p>}
              {c.blockedReasons && (
                <p className="text-[10px] text-red-600">{c.blockedReasons.join(', ')}</p>
              )}
            </div>
            {!disabled && onSelect && (
              <button
                type="button"
                onClick={() => onSelect(c)}
                className="rounded border border-emerald-500 px-2 py-0.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
              >
                {t('organizer.poolsPage.refereesPick')}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatHHMM(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}
