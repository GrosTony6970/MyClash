'use client';

/**
 * RefereesTab — bracket-detail edition. R5 of the Staffing overhaul.
 *
 * Mirrors the pool-detail Referees tab (../../pools/_tabs/RefereesTab.tsx)
 * but filters to bracket + finals "pools" (the synthetic single-match
 * entries the backend produces in R4 for each bracket match).
 *
 * Two sub-sections — Bracket and Finals — so the operator can scan
 * the medal-set separately from the rest of the bracket. Each sub-
 * section shows the same per-pool slot cards + the shared
 * SwapSuggestionsPanel.
 *
 * Data source: the existing
 * `GET /api/v1/events/:eventId/referee-assignment-board` endpoint. R4
 * already includes bracket matches as `kind: 'bracket' | 'finals'`
 * pools in the board response.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { t } from '@myclash/i18n';
import {
  SwapSuggestionsPanel,
  type SwapSuggestion,
} from '../../referees/_components/SwapSuggestionsPanel';
import { assignmentChipClasses } from '../../referees/_components/assignment-chip-classes';
import { formatBracketMatchLabel } from '../../referees/_components/format-bracket-match-label';

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
  kind?: 'pool' | 'bracket' | 'finals';
  matchId?: string;
  /** Bracket-only metadata so the title can render 'Quarter-final #2'
   *  instead of the raw 'R{N}P{M}'. See Slice 3 of the pools+bracket
   *  referees overhaul. */
  bracketRound?: number;
  bracketPosition?: number;
  bracketMaxRound?: number;
  members: Array<{ registrationId: string; personId: string; personName: string }>;
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
  /** Slice 4: local override of the parent's tournamentId — the in-view
   *  tab strip switches between tournaments without forcing the operator
   *  back up to the page-level dropdown. Defaults to the prop. */
  const [activeTournamentId, setActiveTournamentId] = useState<string>(tournamentId);
  useEffect(() => {
    setActiveTournamentId(tournamentId);
  }, [tournamentId]);

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
        if (!res.ok) throw new Error(t('organizer.bracketPage.refereesLoadFailed'));
        setBoard((await res.json()) as AssignmentBoard);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(
          err instanceof Error ? err.message : t('organizer.bracketPage.refereesLoadFailed'),
        );
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

  /**
   * Bracket-kind pools for this tournament. Filters out the real
   * pool-kind entries — those belong on the pool detail page.
   */
  /** Distinct tournaments that have at least one bracket / finals row.
   *  Drives the tab strip — only rendered when there's more than one. */
  const bracketTournaments = useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of allBoardPools) {
      if (p.kind !== 'bracket' && p.kind !== 'finals') continue;
      if (!seen.has(p.tournamentId)) seen.set(p.tournamentId, p.tournamentName || p.tournamentId);
    }
    return Array.from(seen, ([id, name]) => ({ id, name }));
  }, [allBoardPools]);

  const bracketPools = useMemo(
    () =>
      allBoardPools.filter(
        (p) =>
          p.tournamentId === activeTournamentId && (p.kind === 'bracket' || p.kind === 'finals'),
      ),
    [allBoardPools, activeTournamentId],
  );

  const bracketGroup = useMemo(
    () => bracketPools.filter((p) => p.kind === 'bracket'),
    [bracketPools],
  );
  const finalsGroup = useMemo(
    () => bracketPools.filter((p) => p.kind === 'finals'),
    [bracketPools],
  );

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
        throw new Error(body.message ?? t('organizer.bracketPage.refereesAssignFailed'));
      }
      setBoard((await res.json()) as AssignmentBoard);
      setPicker(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('organizer.bracketPage.refereesAssignFailed'),
      );
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
        throw new Error(body.message ?? t('organizer.bracketPage.refereesAssignFailed'));
      }
      await loadBoard();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('organizer.bracketPage.refereesAssignFailed'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function applySwap(s: SwapSuggestion) {
    if (!board) return;
    const pool = allBoardPools.find((p) => p.id === s.fromPoolId);
    const slot = pool?.roleSlots.find((rs) => rs.slotIndex === s.fromSlotIndex);
    if (!slot) return;
    const oldId = slot.assignment?.id;
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
          throw new Error(body.message ?? t('organizer.bracketPage.refereesAssignFailed'));
        }
      }
      await manualAssign(s.fromPoolId, slot.role, s.toPersonId);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('organizer.bracketPage.refereesAssignFailed'),
      );
    } finally {
      setBusy(false);
    }
  }

  if (loading && !board) {
    return <p className="text-sm text-gray-400">{t('organizer.bracketPage.refereesLoading')}</p>;
  }
  if (!board || bracketPools.length === 0) {
    return (
      <div className="rounded-lg border-2 border-dashed border-gray-200 p-8 text-center">
        <p className="text-sm text-gray-400">{t('organizer.bracketPage.refereesEmpty')}</p>
      </div>
    );
  }

  const filteredSwapSuggestions = (board.swapSuggestions ?? []).filter((s) =>
    bracketPools.some((p) => p.id === s.fromPoolId),
  );

  return (
    <section className="space-y-6">
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {bracketTournaments.length > 1 && (
        <nav
          aria-label={t('organizer.bracketPage.refereesTournamentTabsLabel')}
          className="flex flex-wrap gap-2 border-b border-gray-200"
        >
          {bracketTournaments.map((bt) => {
            const active = bt.id === activeTournamentId;
            return (
              <button
                key={bt.id}
                type="button"
                onClick={() => setActiveTournamentId(bt.id)}
                className={[
                  '-mb-px border-b-2 px-3 py-1.5 text-sm font-medium transition-colors',
                  active
                    ? 'border-red-700 text-red-700'
                    : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700',
                ].join(' ')}
              >
                {bt.name}
              </button>
            );
          })}
        </nav>
      )}

      {bracketGroup.length > 0 && (
        <BracketMatchSection
          title={t('organizer.bracketPage.refereesBracketSection')}
          pools={bracketGroup}
          isReadOnly={isReadOnly || board.locked}
          busy={busy}
          skillNameById={skillNameById}
          skillColorById={skillColorById}
          onAssignClick={(pool, slot) => setPicker({ pool, slot })}
          onUnassign={(id) => void unassign(id)}
        />
      )}

      {finalsGroup.length > 0 && (
        <BracketMatchSection
          title={t('organizer.bracketPage.refereesFinalsSection')}
          pools={finalsGroup}
          isReadOnly={isReadOnly || board.locked}
          busy={busy}
          skillNameById={skillNameById}
          skillColorById={skillColorById}
          onAssignClick={(pool, slot) => setPicker({ pool, slot })}
          onUnassign={(id) => void unassign(id)}
        />
      )}

      <SwapSuggestionsPanel
        suggestions={filteredSwapSuggestions}
        isReadOnly={isReadOnly || board.locked}
        busy={busy}
        onApply={(s) => void applySwap(s)}
      />

      {picker && (
        <CandidatePicker
          pool={picker.pool}
          slot={picker.slot}
          onAssign={(userId) => void manualAssign(picker.pool.id, picker.slot.role, userId)}
          onCancel={() => setPicker(null)}
        />
      )}
    </section>
  );
}

// ── Subcomponents ─────────────────────────────────────────────────────────────

function BracketMatchSection({
  title,
  pools,
  isReadOnly,
  busy,
  skillNameById,
  skillColorById,
  onAssignClick,
  onUnassign,
}: {
  title: string;
  pools: AssignmentBoardPool[];
  isReadOnly: boolean;
  busy: boolean;
  skillNameById: Map<string, string>;
  skillColorById: Map<string, string>;
  onAssignClick: (pool: AssignmentBoardPool, slot: AssignmentBoardRoleSlot) => void;
  onUnassign: (assignmentId: string) => void;
}) {
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">{title}</h3>
      {pools.map((pool) => (
        <BracketMatchCard
          key={pool.id}
          pool={pool}
          isReadOnly={isReadOnly}
          busy={busy}
          skillNameById={skillNameById}
          skillColorById={skillColorById}
          onAssignClick={(slot) => onAssignClick(pool, slot)}
          onUnassign={onUnassign}
        />
      ))}
    </section>
  );
}

function BracketMatchCard({
  pool,
  isReadOnly,
  busy,
  skillNameById,
  skillColorById,
  onAssignClick,
  onUnassign,
}: {
  pool: AssignmentBoardPool;
  isReadOnly: boolean;
  busy: boolean;
  skillNameById: Map<string, string>;
  skillColorById: Map<string, string>;
  onAssignClick: (slot: AssignmentBoardRoleSlot) => void;
  onUnassign: (assignmentId: string) => void;
}) {
  // Slice 4: readable round label ('Quarter-final #2') instead of the
  // raw R{N}P{M}. Falls back to pool.name when bracket metadata is
  // missing (e.g. an older payload), so the title is never empty.
  const roundLabel =
    pool.bracketMaxRound !== undefined &&
    pool.bracketRound !== undefined &&
    pool.bracketPosition !== undefined
      ? formatBracketMatchLabel(pool.bracketRound, pool.bracketPosition, pool.bracketMaxRound, t)
      : pool.name;
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <p className="font-semibold text-gray-900">
          {pool.tournamentName ? `${pool.tournamentName} – ${roundLabel}` : roundLabel}
        </p>
        {pool.scheduledStart && (
          <p className="text-xs text-gray-500">{formatHHMM(pool.scheduledStart)}</p>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {pool.roleSlots.map((slot) => (
          <div
            key={`${slot.slotIndex}:${slot.role}`}
            className={[
              'rounded-md border px-3 py-2',
              assignmentChipClasses({
                hasAssignment: !!slot.assignment,
                isError: slot.missingReasons.length > 0 && !slot.assignment,
                skillColor: skillColorById.get(slot.role) ?? null,
              }),
            ].join(' ')}
          >
            <p className="text-[10px] font-semibold uppercase tracking-wider opacity-70">
              {slot.displayName ?? skillNameById.get(slot.role) ?? slot.role}
            </p>
            {slot.assignment ? (
              <div className="mt-1 flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{slot.assignment.displayName}</p>
                <button
                  type="button"
                  disabled={isReadOnly || busy}
                  onClick={() => onUnassign(slot.assignment!.id)}
                  className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                >
                  {t('organizer.bracketPage.refereesUnassign')}
                </button>
              </div>
            ) : (
              <div className="mt-1 flex items-center justify-between gap-2">
                <p className="text-sm text-gray-500">
                  {t('organizer.bracketPage.refereesUnassigned')}
                </p>
                <button
                  type="button"
                  disabled={isReadOnly || busy}
                  onClick={() => onAssignClick(slot)}
                  className="rounded border border-gray-300 px-2 py-0.5 text-xs hover:bg-gray-50 disabled:opacity-50"
                >
                  {t('organizer.bracketPage.refereesAssign')}
                </button>
              </div>
            )}
            {slot.missingReasons.length > 0 && !slot.assignment && (
              <p className="mt-1 text-[10px] text-red-700">{slot.missingReasons.join(', ')}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function CandidatePicker({
  pool,
  slot,
  onAssign,
  onCancel,
}: {
  pool: AssignmentBoardPool;
  slot: AssignmentBoardRoleSlot;
  onAssign: (userId: string) => void;
  onCancel: () => void;
}) {
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
            {t('organizer.bracketPage.refereesCancel')}
          </button>
        </div>
        <div className="max-h-96 space-y-3 overflow-y-auto">
          <CandidateGroup
            title={t('organizer.bracketPage.refereesPickerRecommended')}
            candidates={slot.candidates.recommended}
            onSelect={(c) => onAssign(c.userId)}
          />
          <CandidateGroup
            title={t('organizer.bracketPage.refereesPickerBlocked')}
            candidates={slot.candidates.blocked.map((c) => ({ ...c, blockedReasons: c.reasons }))}
            disabled
          />
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
                {t('organizer.bracketPage.refereesPick')}
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
