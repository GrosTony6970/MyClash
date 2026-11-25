'use client';

/**
 * Pool & bracket management — T-704
 * Route: /org/[slug]/events/[eventId]/pools
 *
 * AC:
 *   ✓ Pool count + size configurable
 *   ✓ Manual override of pool assignments (drag-drop)
 *   ✓ "Force regenerate" with confirmation modal
 *   ✓ Fighter/referee conflict detection (hard constraint)
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { EventCrumb, OrgCrumb } from '@/components/Crumbs';
import {
  ConfirmDialog,
  HelpTooltip,
  RowActionButton,
  TournamentColorDot,
  useToast,
  nameOrUnknown,
} from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { MatchesTab } from './_tabs/MatchesTab';
import { StandingsTab } from './_tabs/StandingsTab';
import { RefereesTab } from './_tabs/RefereesTab';
import { parseHashTab } from './parse-hash-tab';
import { RegenerateConfirms } from './RegenerateConfirms';
import { TeamSpreadChoice } from './TeamSpreadChoice';
import { recordConflictCheck, type ConflictChecks } from './conflict-checks';
import { RefereeVerdictBanner } from '@/components/RefereeVerdictBanner';
import { UncheckedFightersNotice } from '@/components/UncheckedFightersNotice';
import type { RefereeConflictEntry } from '@/lib/referee-reasons';
import { useEventStatus } from '../_hooks/useEventStatus';
import { apiRequest, failureMessage, type ApiFailure, type ApiResult } from '@myclash/api-client';
import { discardFailureMessage, foughtBoutsAtStake } from '@/lib/discard-refusal';
import { kindRefusal } from '@/lib/named-refusal';
import { getPublicApiUrl } from '@/lib/api-url';
import { withTournament } from '@/lib/tournament-choice';
import { useTournamentChoice } from '@/hooks/useTournamentChoice';
import {
  generateBody,
  seatBody,
  seatKindOf,
  seatWords,
  type PoolMemberSeat,
  type TeamSpread,
} from './pool-seats';
import type { PoolSeat } from '@myclash/types/pool-standings';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Pool {
  id: string;
  name: string;
  members: PoolMemberSeat[];
}

interface PoolsResponse {
  phaseId: string | null;
  pools: Pool[];
}

const UNASSIGNED_DROP_ID = '__unassigned__';

/** The one checker's verdicts that concern this Tournament (ADR-016). */
interface ConflictResult {
  conflicts: RefereeConflictEntry[];
}

/**
 * A body with no verdict list is a failed check, not a clean one: a changed shape must
 * say "could not be checked" rather than render nothing (hard rule 8).
 */
function asConflictResult(data: unknown): ConflictResult | null {
  const conflicts = (data as { conflicts?: unknown } | null)?.conflicts;
  return Array.isArray(conflicts) ? { conflicts: conflicts as RefereeConflictEntry[] } : null;
}

// ── Tab shell ─────────────────────────────────────────────────────────────────

type TabKey = 'configure' | 'matches' | 'standings' | 'referees';

const TABS: Array<{ key: TabKey; labelKey: string }> = [
  { key: 'configure', labelKey: 'organizer.pools.tabs.configure' },
  { key: 'matches', labelKey: 'organizer.pools.tabs.matches' },
  { key: 'standings', labelKey: 'organizer.pools.tabs.standings' },
  { key: 'referees', labelKey: 'organizer.pools.tabs.referees' },
];

function readHashTab(): TabKey {
  if (typeof window === 'undefined') return 'configure';
  // Inner tabs (e.g. StandingsTab) layer their own state into the
  // hash as `<tab>-<inner-state>` — read just the leading segment so
  // `#standings-by-pool` stays on the Standings tab instead of
  // falling through to the default and yanking the operator back.
  return (
    parseHashTab(
      window.location.hash,
      TABS.map((t) => t.key),
    ) ?? 'configure'
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PoolsPage() {
  const params = useParams<{ slug: string; eventId: string }>();
  const { slug, eventId } = params;
  const apiUrl = getPublicApiUrl();
  const { t } = useI18n();
  const { isReadOnly } = useEventStatus(eventId);

  const [tournaments, setTournaments] = useState<
    Array<{ id: string; name: string; color?: string | null; entrant_kind?: string | null }>
  >([]);
  const [selectedTournament, setSelectedTournament] = useTournamentChoice(
    eventId,
    tournaments.map((tour) => tour.id),
  );
  // Derived: the row matching the active id, surfaced to the
  // breadcrumb + picker so the tournament name follows the operator
  // across every subtab without threading a new prop.
  const selectedTournamentObj = tournaments.find((t) => t.id === selectedTournament) ?? null;
  // A team Tournament seats teams. Until the list lands the page reads individual, and a
  // generation sent then is refused by the API with its own sentence (`entrant_kind_field`).
  const seatKind = seatKindOf(selectedTournamentObj);
  const words = seatWords(seatKind);
  const [pools, setPools] = useState<Pool[] | null>(null);
  const [poolPhaseId, setPoolPhaseId] = useState<string | null>(null);
  // Kept per Tournament, so a check that answers after a switch stays with its own.
  const [conflictChecks, setConflictChecks] = useState<ConflictChecks<ConflictResult>>({});
  const conflictCheckSeq = useRef(0);
  const conflictCheck = conflictChecks[selectedTournament];
  const conflicts = conflictCheck?.result ?? null;
  const conflictCheckFailed = conflictCheck !== undefined && conflictCheck.result === null;

  // Config
  const [mode, setMode] = useState<'poolCount' | 'targetSize'>('targetSize');
  const [poolCount, setPoolCount] = useState(4);
  const [targetSize, setTargetSize] = useState(8);
  const [schoolSep, setSchoolSep] = useState(true);
  const [skillBalance, setSkillBalance] = useState(true);
  const [teamSpread, setTeamSpread] = useState<TeamSpread>('seed');

  // UI state
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForceConfirm, setShowForceConfirm] = useState(false);
  // How many fought bouts a forced regeneration would delete; null = not asked.
  const [foughtAtStake, setFoughtAtStake] = useState<number | null>(null);
  const [existingPhase, setExistingPhase] = useState(false);
  // Lifecycle (delete one, delete all, add empty)
  const [pendingDeletePoolId, setPendingDeletePoolId] = useState<string | null>(null);
  const [pendingDeleteAll, setPendingDeleteAll] = useState(false);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const toast = useToast();

  // ── Tab state ───────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<TabKey>('configure');

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs the active tab from the URL hash on mount and on hashchange
    setActiveTab(readHashTab());
    function onHash() {
      setActiveTab(readHashTab());
    }
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  function selectTab(key: TabKey) {
    // eslint-disable-next-line react-hooks/immutability -- intentional navigation side-effect: hashchange listener drives the tab state
    window.location.hash = `#${key}`;
  }

  // Drag state. fromPoolId === UNASSIGNED_DROP_ID means the entrant is dragged
  // from the unassigned bucket (no source pool delete needed).
  const [dragging, setDragging] = useState<{
    seat: PoolSeat;
    fromPoolId: string;
  } | null>(null);

  // Unassigned bucket + member editing state
  const [unassigned, setUnassigned] = useState<PoolSeat[]>([]);
  const [editBusy, setEditBusy] = useState(false);
  const [lockBanner, setLockBanner] = useState<string | null>(null);
  const [renamingPoolId, setRenamingPoolId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [renameBusy, setRenameBusy] = useState(false);

  // ── Load tournaments ────────────────────────────────────────────────────────

  useEffect(() => {
    const controller = new AbortController();
    // Silent: the picker stays empty and every action below reports its own
    // refusal against the tournament it was asked for.
    void apiRequest<Array<{ id: string; name: string }>>(
      apiUrl,
      `/api/v1/events/${eventId}/tournaments`,
      { signal: controller.signal },
    ).then((r) => {
      if (r.ok) setTournaments(r.data);
    });
    return () => controller.abort();
  }, [eventId, apiUrl]);

  // ── Load existing pools ─────────────────────────────────────────────────────

  async function loadPools(tournamentId: string, signal?: AbortSignal) {
    const [poolsRes, unassignedRes] = await Promise.all([
      apiRequest<Pool[] | PoolsResponse>(apiUrl, `/api/v1/tournaments/${tournamentId}/pools`, {
        signal,
      }),
      apiRequest<PoolSeat[]>(apiUrl, `/api/v1/tournaments/${tournamentId}/unassigned-fighters`, {
        signal,
      }),
    ]);

    if (poolsRes.ok) {
      const data = poolsRes.data;
      const nextPools = Array.isArray(data) ? data : data.pools;
      if (!Array.isArray(data)) {
        setPoolPhaseId(data.phaseId);
      }
      setPools(nextPools);
      setExistingPhase(nextPools.length > 0);
    }

    if (unassignedRes.ok) {
      setUnassigned(unassignedRes.data);
    }
  }

  async function checkConflicts() {
    if (!selectedTournament) return;
    // A failed check SAYS so. Kept silent, it showed nothing, and nothing reads
    // as "no fighter/referee conflicts" (hard rule 8). It replaces the old strip,
    // which is older than the load or the edit that asked for this check.
    const tournamentId = selectedTournament;
    const seq = ++conflictCheckSeq.current;
    const r = await apiRequest<unknown>(
      apiUrl,
      `/api/v1/tournaments/${tournamentId}/conflict-check`,
    );
    setConflictChecks((checks) =>
      recordConflictCheck(checks, tournamentId, seq, r.ok ? asConflictResult(r.data) : null),
    );
  }

  useEffect(() => {
    if (!selectedTournament) return;
    const controller = new AbortController();
    // The last Tournament's Pools are not this one's: kept, its teams or Fighters would stand
    // in for this one's until (or, on a failed read, after) the load lands.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets the per-Tournament view on a switch, before the fetch below
    setPools(null);
    void loadPools(selectedTournament, controller.signal);
    // Checked whenever a Tournament's pools load, not only after an edit here:
    // a referee set on a Match or a bout moved on the grid makes a clash without
    // touching this page, and a Tournament never checked shows the same nothing
    // as a clean one (hard rule 8). Not aborted on a switch: the answer is kept
    // under the Tournament it was asked for (conflict-checks.ts).
    void checkConflicts();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTournament, apiUrl]);

  // ── Generate pools ──────────────────────────────────────────────────────────

  /**
   * A refusal the page answers with a confirm, not with a message.
   *
   * Fought bouts would go: the second confirm names how many, and its yes sends
   * that count (rulings 280, 288). Else a 409 of an UNFORCED call means Pools already
   * exist, and the page offers to overwrite them. A forced call's other 409 is
   * said: asked again, it would be refused again, for ever. So is a refusal of the
   * Tournament's kind, forced or not.
   */
  function asksToConfirm(refusal: ApiFailure, force: boolean): boolean {
    const fought = foughtBoutsAtStake(refusal);
    const poolsExist =
      refusal.kind === 'http' && refusal.status === 409 && !kindRefusal(refusal, t);
    if (fought !== null) setFoughtAtStake(fought);
    else if (!force && poolsExist) setShowForceConfirm(true);
    else return false;
    return true;
  }

  async function generate(force = false, discard = 0) {
    if (!selectedTournament) return;
    setGenerating(true);
    setError(null);
    setShowForceConfirm(false);
    setFoughtAtStake(null);

    try {
      const body = generateBody(seatKind, {
        mode,
        poolCount,
        targetSize,
        schoolSeparation: schoolSep,
        skillBalance,
        teamSpread,
        discard,
      });

      // The response body is deliberately unread: the GET endpoint below is
      // the source of truth for the full Pool[] shape (members included), and
      // the generate POST returns a "matchCount only" summary.
      const r = await apiRequest(
        apiUrl,
        `/api/v1/tournaments/${selectedTournament}/generate-pools${force ? '?force=true' : ''}`,
        { method: 'POST', body },
      );

      if (!r.ok) {
        if (asksToConfirm(r, force)) return;
        const message = discardFailureMessage(r, t, t('admin.common.poolGenerationFailed'));
        if (message) throw new Error(message);
        return;
      }

      setExistingPhase(true);
      await loadPools(selectedTournament);

      // Check conflicts
      await checkConflicts();

      // Pools just created — take the operator straight to the matches view.
      selectTab('matches');
    } catch (err) {
      const message = err instanceof Error ? err.message : t('admin.common.poolGenerationFailed');
      setError(message);
      toast.error(message);
    } finally {
      setGenerating(false);
    }
  }

  // ── Pool lifecycle (delete one / delete all / add empty) ──────────────────

  async function confirmDeleteOne() {
    if (!pendingDeletePoolId) return;
    setLifecycleBusy(true);
    setError(null);
    try {
      const r = await apiRequest(apiUrl, `/api/v1/pools/${pendingDeletePoolId}`, {
        method: 'DELETE',
      });
      if (!r.ok) {
        // A pool is refused by what still points at it — a scored bout, a
        // referee crew — and that sentence is the one the operator can act on.
        const message = failureMessage(r, t, t('admin.common.couldNotDeletePool'));
        if (message) throw new Error(message);
        return;
      }
      toast.success(t('admin.common.poolDeletedToast'));
      setPendingDeletePoolId(null);
      if (selectedTournament) await loadPools(selectedTournament);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('admin.common.couldNotDeletePool');
      setError(message);
      toast.error(message);
    } finally {
      setLifecycleBusy(false);
    }
  }

  async function confirmDeleteAll() {
    if (!selectedTournament) return;
    setLifecycleBusy(true);
    setError(null);
    try {
      const r = await apiRequest(apiUrl, `/api/v1/tournaments/${selectedTournament}/pools`, {
        method: 'DELETE',
      });
      if (!r.ok) {
        const message = failureMessage(r, t, t('admin.common.couldNotClearPoolLayout'));
        if (message) throw new Error(message);
        return;
      }
      toast.success(t('admin.common.allPoolsDeletedToast'));
      setPendingDeleteAll(false);
      setExistingPhase(false);
      await loadPools(selectedTournament);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t('admin.common.couldNotClearPoolLayout');
      setError(message);
      toast.error(message);
    } finally {
      setLifecycleBusy(false);
    }
  }

  async function addEmptyPool() {
    if (!selectedTournament) return;
    setLifecycleBusy(true);
    setError(null);
    try {
      const r = await apiRequest<{ id: string; name: string; sortOrder: number }>(
        apiUrl,
        `/api/v1/tournaments/${selectedTournament}/pools/empty`,
        { method: 'POST' },
      );
      if (!r.ok) {
        const message = failureMessage(r, t, t('admin.common.couldNotAddEmptyPool'));
        if (message) throw new Error(message);
        return;
      }
      toast.success(t('admin.common.poolAddedToast', { name: r.data.name }));
      setExistingPhase(true);
      await loadPools(selectedTournament);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('admin.common.couldNotAddEmptyPool');
      setError(message);
      toast.error(message);
    } finally {
      setLifecycleBusy(false);
    }
  }

  // Phase visibility is no longer an operator toggle — tournament status
  // is the canonical public gate (see events.service.getPublicTournamentStandings).
  // The "Notify participants" link is always reachable below once a pool
  // phase exists; operators don't need to publish anything separately.
  const notifyHref = useMemo(() => {
    if (!poolPhaseId || !selectedTournament) return null;
    const query = new URLSearchParams({
      targetType: 'fighters_and_referees',
      severity: 'info',
      tournamentId: selectedTournament,
      title: t('organizer.phaseVisibility.poolsReadyTitle'),
      body: t('organizer.phaseVisibility.poolsReadyBody'),
    });
    return `/org/${slug}/events/${eventId}/notifications?${query.toString()}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t is a stable EN-bound import from @myclash/i18n, not a reactive dependency
  }, [poolPhaseId, selectedTournament, slug, eventId]);

  // ── Drag-drop pool member edit ──────────────────────────────────────────────

  /**
   * The one reader for a pool edit's outcome. A 409 is its own banner — the
   * pool is locked because scoring has started, which is a state rather than a
   * mistake — and everything else is an error.
   */
  function handlePoolEditResult(r: ApiResult<unknown>): boolean {
    if (r.ok) {
      setLockBanner(null);
      return true;
    }
    // A seat of the other kind of entrant is a mistake, not a locked Pool.
    const refusedKind = kindRefusal(r, t);
    if (refusedKind) {
      setError(refusedKind);
      return false;
    }
    if (r.kind === 'http' && r.status === 409) {
      setLockBanner(failureMessage(r, t, t('admin.common.poolLockedScoringStarted')));
      return false;
    }
    setError(failureMessage(r, t, t('organizer.phaseVisibility.updateError')));
    return false;
  }

  async function moveMemberToPool(seat: PoolSeat, toPoolId: string) {
    setEditBusy(true);
    try {
      const r = await apiRequest(apiUrl, `/api/v1/pools/${toPoolId}/members`, {
        method: 'POST',
        body: seatBody(seat),
      });
      const ok = handlePoolEditResult(r);
      if (ok) {
        await loadPools(selectedTournament);
        await checkConflicts();
      }
    } finally {
      setEditBusy(false);
    }
  }

  /** A seat leaves its Pool by its side key: the team id or the Registration id. */
  async function removeMemberFromPool(fromPoolId: string, seat: PoolSeat) {
    setEditBusy(true);
    try {
      const r = await apiRequest(apiUrl, `/api/v1/pools/${fromPoolId}/members/${seat.sideId}`, {
        method: 'DELETE',
      });
      const ok = handlePoolEditResult(r);
      if (ok) {
        await loadPools(selectedTournament);
        await checkConflicts();
      }
    } finally {
      setEditBusy(false);
    }
  }

  async function handleDrop(toPoolId: string) {
    if (!dragging || isReadOnly) return;
    const { seat, fromPoolId } = dragging;
    setDragging(null);
    if (fromPoolId === toPoolId) return;
    await moveMemberToPool(seat, toPoolId);
  }

  async function handleDropOnUnassigned() {
    if (!dragging || isReadOnly) return;
    const { seat, fromPoolId } = dragging;
    setDragging(null);
    if (fromPoolId === UNASSIGNED_DROP_ID) return;
    await removeMemberFromPool(fromPoolId, seat);
  }

  async function startRename(pool: Pool) {
    setRenamingPoolId(pool.id);
    setRenameDraft(pool.name);
    setLockBanner(null);
  }

  async function saveRename(poolId: string) {
    const next = renameDraft.trim();
    if (!next) {
      setRenamingPoolId(null);
      return;
    }
    setRenameBusy(true);
    try {
      const r = await apiRequest(apiUrl, `/api/v1/pools/${poolId}`, {
        method: 'PATCH',
        body: { name: next },
      });
      const ok = handlePoolEditResult(r);
      if (ok) {
        setPools((prev) =>
          prev ? prev.map((p) => (p.id === poolId ? { ...p, name: next } : p)) : prev,
        );
        setRenamingPoolId(null);
      }
    } finally {
      setRenameBusy(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-[110rem] px-6 py-8 lg:px-8">
      <nav
        aria-label={t('organizer.pools.page.sectionsAria')}
        className="mb-6 flex gap-1 border-b border-border"
      >
        {TABS.map((tab) => {
          const disabled =
            (tab.key === 'matches' && !poolPhaseId) ||
            (tab.key === 'standings' && !poolPhaseId) ||
            (tab.key === 'referees' && !selectedTournament);
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => !disabled && selectTab(tab.key)}
              disabled={disabled}
              title={disabled ? t('organizer.pools.tabs.disabledHint') : undefined}
              className={[
                'border-b-2 px-4 py-2 text-sm font-medium transition-colors',
                activeTab === tab.key
                  ? 'border-accent text-accent'
                  : disabled
                    ? 'border-transparent text-muted cursor-not-allowed'
                    : 'border-transparent text-foreground-secondary hover:text-foreground',
              ].join(' ')}
            >
              {t(tab.labelKey)}
            </button>
          );
        })}
      </nav>

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted mb-1">
            <OrgCrumb slug={slug} className="hover:text-foreground-secondary" />
            <span>/</span>
            <EventCrumb
              slug={slug}
              eventId={eventId}
              className="hover:text-foreground-secondary"
              fallback={t('organizer.phaseVisibility.breadcrumbEvent')}
            />
            <span>/</span>
            <span className={selectedTournamentObj ? 'text-muted' : 'text-foreground font-medium'}>
              {t('organizer.phaseVisibility.breadcrumbPools')}
            </span>
            {selectedTournamentObj && (
              <>
                <span>/</span>
                <span className="inline-flex items-center gap-1.5 text-foreground font-medium">
                  <TournamentColorDot color={selectedTournamentObj.color} />
                  {selectedTournamentObj.name}
                </span>
              </>
            )}
          </div>
          <h1 className="font-display font-bold text-2xl sm:text-3xl">
            {t('organizer.phaseVisibility.poolsTitle')}
          </h1>
        </div>
        <Link
          href={`/org/${slug}/events/${eventId}/ai-assistant?type=pool_plan${selectedTournament ? `&tournamentId=${selectedTournament}` : ''}`}
          className="border border-border hover:border-border text-foreground-secondary font-medium py-2 px-4 rounded-lg text-sm transition-colors"
        >
          {t('organizer.aiAssistant.suggest')}
        </Link>
        <Link
          href={withTournament(`/org/${slug}/events/${eventId}/bracket`, selectedTournament)}
          className="border border-border hover:border-border text-foreground-secondary font-medium py-2 px-4 rounded-lg text-sm transition-colors"
        >
          {t('organizer.pools.page.toBracket')}
        </Link>
      </div>

      {/* Tournament selector — visible on every subtab so the operator
          always knows which tournament their actions apply to. */}
      {tournaments.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {tournaments.map((tour) => {
            const active = selectedTournament === tour.id;
            return (
              <button
                key={tour.id}
                type="button"
                onClick={() => setSelectedTournament(tour.id)}
                className={[
                  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors',
                  active
                    ? 'bg-accent text-accent-foreground border-accent'
                    : 'bg-surface text-foreground-secondary border-border hover:border-border',
                ].join(' ')}
              >
                <TournamentColorDot color={tour.color} />
                {tour.name}
              </button>
            );
          })}
        </div>
      )}

      {/* Rule 8 cannot check a team's unnamed Fighters (ADR-016, 2026-11-13). Said once for the
          page, so the tabs that assign referees (Referees, per Pool; Matches, per bout) and the
          one that shows the referee verdicts all carry it. A note: it blocks nothing.
          It follows the Tournament's kind, not the loaded Pools: the tabs below read their own
          data and can staff a team Pool while the Pools load, or after their read failed. A
          team Tournament seats only teams; with no Tournament list there is no Tournament. */}
      {activeTab !== 'standings' && seatKind === 'team' && (
        <div className="mb-4">
          <UncheckedFightersNotice />
        </div>
      )}

      {activeTab === 'configure' && (
        <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
          {/* ── Left column: banners + pool grid ────────────────────────────── */}
          <div className="space-y-4">
            {/* Notify participants — surfaced once pools exist. Phase
                visibility is no longer a separate toggle; the tournament's
                own status gates public reveal. */}
            {notifyHref && (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface p-4">
                <Link href={notifyHref} className="text-sm font-semibold text-accent underline">
                  {t('organizer.phaseVisibility.notifyParticipants')}
                </Link>
              </div>
            )}

            {/* Referee verdicts (hard rule 8, ADR-016): red Impossible, amber to confirm,
                grey confirmed. Nothing to act on — nothing but grey — shows no banner. */}
            {conflicts && conflicts.conflicts.some((c) => c.level !== 'fine') && (
              <RefereeVerdictBanner conflicts={conflicts.conflicts} />
            )}
            {conflictCheckFailed && (
              <div
                role="alert"
                className="flex flex-wrap items-center gap-3 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning"
              >
                <span>{t('organizer.pools.page.conflictsCheckFailed')}</span>
                <button
                  type="button"
                  onClick={() => void checkConflicts()}
                  className="w-fit rounded-md border border-warning/30 bg-surface px-3 py-1.5 text-xs font-semibold text-warning hover:bg-warning/10"
                >
                  {t('actions.retry')}
                </button>
              </div>
            )}

            {lockBanner && (
              <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-2.5 text-sm text-warning">
                <strong className="font-semibold">{lockBanner}</strong>
                <span className="ml-2 text-warning">
                  {t('organizer.pools.page.lockBannerHint')}
                </span>
              </div>
            )}

            {error && (
              <div className="bg-danger/10 border border-danger/30 text-danger rounded-lg px-4 py-3 text-sm">
                {error}
              </div>
            )}

            <RegenerateConfirms
              askOverwrite={showForceConfirm}
              foughtAtStake={foughtAtStake}
              onCancel={() => {
                setShowForceConfirm(false);
                setFoughtAtStake(null);
              }}
              onOverwrite={() => void generate(true)}
              onDiscard={() => void generate(true, foughtAtStake ?? 0)}
            />

            {/* Pool cards with drag-drop — one pool per row, full width of
                the left column. Stacks vertically so each pool's fighter
                list reads horizontally with room for the club label. */}
            {pools && pools.length > 0 && (
              <div className="flex flex-col gap-4">
                {pools.map((pool) => (
                  <div
                    key={pool.id}
                    className={[
                      'w-full border-2 rounded-xl p-4 transition-colors',
                      dragging ? 'border-dashed border-accent bg-accent/5' : 'border-border',
                    ].join(' ')}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => void handleDrop(pool.id)}
                  >
                    <div className="mb-3 flex items-start justify-between gap-2">
                      <div className="flex flex-1 flex-col gap-0.5 min-w-0">
                        {renamingPoolId === pool.id ? (
                          <div className="flex items-center gap-2">
                            <input
                              value={renameDraft}
                              onChange={(e) => setRenameDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') void saveRename(pool.id);
                                if (e.key === 'Escape') setRenamingPoolId(null);
                              }}
                              // eslint-disable-next-line jsx-a11y/no-autofocus -- intentional focus of the inline rename field when it appears
                              autoFocus
                              className="flex-1 rounded-md border border-border px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                            />
                            <button
                              type="button"
                              disabled={renameBusy}
                              onClick={() => void saveRename(pool.id)}
                              className="rounded-md bg-accent px-3 py-1 text-xs font-semibold text-accent-foreground hover:bg-accent-hover disabled:opacity-50"
                            >
                              {t('organizer.pools.page.save')}
                            </button>
                            <button
                              type="button"
                              onClick={() => setRenamingPoolId(null)}
                              className="rounded-md px-3 py-1 text-xs text-muted hover:text-foreground-secondary"
                            >
                              {t('organizer.pools.page.cancel')}
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void startRename(pool)}
                            disabled={isReadOnly}
                            title={t('organizer.pools.page.renameTitle')}
                            className="self-start font-bold text-foreground hover:text-accent hover:underline decoration-dotted"
                          >
                            {pool.name}
                          </button>
                        )}
                        <span className="text-xs text-muted">
                          {t(pool.members.length === 1 ? words.countOne : words.countMany, {
                            count: pool.members.length,
                          })}
                        </span>
                      </div>
                      <RowActionButton
                        variant="danger"
                        onClick={() => setPendingDeletePoolId(pool.id)}
                        disabled={lifecycleBusy || renamingPoolId === pool.id || isReadOnly}
                        title={t('organizer.pools.page.deletePoolTitle')}
                      >
                        {t('organizer.pools.page.delete')}
                      </RowActionButton>
                    </div>
                    {/* Inline chip layout — fighters flow left-to-right and
                        wrap to the next line when the row is full. Same
                        info density as the previous vertical stack; just
                        denser horizontally. The per-chip name max-width
                        keeps a pathological 40-char name from pushing the
                        seed/HEMA badges off-screen. */}
                    <div className="flex flex-wrap gap-1.5">
                      {pool.members.map((m) => (
                        <div
                          key={m.sideId}
                          draggable={!isReadOnly}
                          onDragStart={() => setDragging({ seat: m, fromPoolId: pool.id })}
                          onDragEnd={() => setDragging(null)}
                          className="group inline-flex items-center gap-1.5 max-w-full bg-surface border border-border rounded-lg px-2 py-1 text-sm cursor-grab active:cursor-grabbing hover:border-border transition-colors"
                        >
                          <TournamentColorDot color={m.colour} />
                          <span className="font-medium text-foreground truncate max-w-[12rem]">
                            {nameOrUnknown(m.name, 'fighter', t)}
                          </span>
                          {m.clubLabel && (
                            <span className="text-muted text-xs truncate max-w-[8rem]">
                              {m.clubLabel}
                            </span>
                          )}
                          {m.hemaWeightedRating !== null && (
                            <span
                              className="rounded-full bg-gold/10 px-2 py-0.5 text-[11px] font-bold text-gold-text"
                              title={t('organizer.pools.page.hemaRatingTitle')}
                            >
                              {m.hemaWeightedRating.toFixed(1)}
                            </span>
                          )}
                          <span className="rounded-full bg-border px-2 py-0.5 text-[11px] font-semibold text-foreground-secondary">
                            #{m.seed}
                          </span>
                          <button
                            type="button"
                            disabled={editBusy || isReadOnly}
                            onClick={() => void removeMemberFromPool(pool.id, m)}
                            title={t('organizer.pools.page.moveToUnassignedTitle')}
                            className="opacity-0 group-hover:opacity-100 transition-opacity rounded p-0.5 text-muted hover:bg-danger/10 hover:text-danger disabled:opacity-30"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                      {pool.members.length === 0 && (
                        <p className="text-xs text-muted italic">{t(words.dropHere)}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!pools && !generating && (
              <div className="text-center py-16 border-2 border-dashed border-border rounded-xl">
                <p className="text-muted text-sm">{t('organizer.pools.page.emptyPools')}</p>
              </div>
            )}
          </div>

          {/* ── Right sidebar: config form + constraints + lifecycle ─────────── */}
          <aside className="sticky top-6 self-start space-y-4 rounded-lg border border-border bg-surface p-4">
            {/* Basic config: sizing mode + count/size stepper */}
            <div>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
                {t('organizer.pools.page.configTitle')}
              </h2>

              {/* Mode toggle */}
              <div className="mb-3">
                <p className="text-xs font-medium text-foreground-secondary mb-2">
                  {t('organizer.pools.page.sizingLabel')}
                </p>
                <div className="flex flex-col gap-1.5">
                  <button
                    onClick={() => setMode('targetSize')}
                    title={t('organizer.pools.page.modeTargetSizeTitle')}
                    className={[
                      'px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors text-left',
                      mode === 'targetSize'
                        ? 'bg-accent text-accent-foreground border-accent'
                        : 'bg-surface text-foreground-secondary border-border',
                    ].join(' ')}
                  >
                    {t('organizer.pools.page.modeTargetSize')}
                  </button>
                  <button
                    onClick={() => setMode('poolCount')}
                    title={t('organizer.pools.page.modePoolCountTitle')}
                    className={[
                      'px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors text-left',
                      mode === 'poolCount'
                        ? 'bg-accent text-accent-foreground border-accent'
                        : 'bg-surface text-foreground-secondary border-border',
                    ].join(' ')}
                  >
                    {t('organizer.pools.page.modePoolCount')}
                  </button>
                </div>
              </div>

              {/* Value stepper */}
              <div>
                <p className="text-xs font-medium text-foreground-secondary mb-2">
                  {mode === 'targetSize'
                    ? t(words.perPool)
                    : t('organizer.pools.page.numberOfPools')}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() =>
                      mode === 'targetSize'
                        ? setTargetSize((v) => Math.max(2, v - 1))
                        : setPoolCount((v) => Math.max(1, v - 1))
                    }
                    className="w-8 h-8 rounded-lg border border-border text-foreground-secondary hover:bg-background font-bold"
                  >
                    −
                  </button>
                  <span className="text-lg font-bold w-8 text-center">
                    {mode === 'targetSize' ? targetSize : poolCount}
                  </span>
                  <button
                    onClick={() =>
                      mode === 'targetSize'
                        ? setTargetSize((v) => Math.min(20, v + 1))
                        : setPoolCount((v) => v + 1)
                    }
                    className="w-8 h-8 rounded-lg border border-border text-foreground-secondary hover:bg-background font-bold"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Preview line */}
              {selectedTournament && !existingPhase && (
                <p className="mt-3 text-xs text-muted">
                  {(() => {
                    const fighters = unassigned.length;
                    const count =
                      mode === 'poolCount'
                        ? Math.max(1, poolCount)
                        : Math.max(1, Math.ceil((fighters || 1) / Math.max(1, targetSize)));
                    if (fighters === 0) {
                      return t(count > 1 ? words.previewEmptyMany : words.previewEmptyOne, {
                        count,
                      });
                    }
                    const avg = Math.round(fighters / count);
                    return t(count > 1 ? words.previewMany : words.previewOne, {
                      count,
                      avg,
                      total: fighters,
                    });
                  })()}
                </p>
              )}
            </div>

            {/* Constraints section: pool generation constraints */}
            <div className="space-y-3 border-t border-border pt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
                {t('organizer.pools.configure.constraints')}
              </h3>

              {/* A team has no club and no rating: its Pools are spread by seed or drawn. */}
              {seatKind === 'team' ? (
                <TeamSpreadChoice value={teamSpread} onChange={setTeamSpread} />
              ) : (
                <>
                  <label className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex items-center">
                      {t('organizer.pools.configure.schoolSeparation')}
                      <HelpTooltip text={t('organizer.pools.configure.help.schoolSeparation')} />
                    </span>
                    <input
                      type="checkbox"
                      checked={schoolSep}
                      onChange={(e) => setSchoolSep(e.target.checked)}
                    />
                  </label>

                  <label className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex items-center">
                      {t('organizer.pools.configure.skillBalance')}
                      <HelpTooltip text={t('organizer.pools.configure.help.skillBalance')} />
                    </span>
                    <input
                      type="checkbox"
                      checked={skillBalance}
                      onChange={(e) => setSkillBalance(e.target.checked)}
                    />
                  </label>
                </>
              )}
            </div>

            {/* Lifecycle actions */}
            <div className="space-y-2 border-t border-border pt-4">
              <button
                onClick={() => void generate(false)}
                disabled={generating || !selectedTournament || isReadOnly}
                title={isReadOnly ? t('organizer.deletionRequest.archivedReadOnly') : undefined}
                className="w-full bg-accent hover:bg-accent-hover disabled:opacity-50 text-accent-foreground font-semibold py-2 px-5 rounded-lg text-sm transition-colors"
              >
                {generating
                  ? t('organizer.pools.page.generating')
                  : existingPhase
                    ? t('organizer.pools.page.regenerate')
                    : unassigned.length === 0
                      ? t('organizer.pools.page.generateEmpty')
                      : t('organizer.pools.page.generateButton')}
              </button>
              <button
                type="button"
                onClick={() => void addEmptyPool()}
                disabled={lifecycleBusy || !selectedTournament || isReadOnly}
                className="w-full rounded-lg border border-border bg-surface px-4 py-2 text-sm font-semibold text-foreground-secondary hover:bg-background disabled:opacity-50 transition-colors"
              >
                {t('organizer.pools.page.addEmptyPool')}
              </button>
              <button
                type="button"
                onClick={() => setPendingDeleteAll(true)}
                disabled={lifecycleBusy || !existingPhase || !selectedTournament || isReadOnly}
                className="w-full rounded-lg border border-danger/30 bg-danger/10 px-4 py-2 text-sm font-semibold text-danger hover:bg-danger/20 disabled:opacity-50 transition-colors"
              >
                {t('organizer.pools.page.deleteAllButton')}
              </button>
              {existingPhase && (
                <Link
                  href={`/org/${slug}/events/${eventId}/referees#assignments`}
                  className="block w-full rounded-lg border border-border bg-surface px-4 py-2 text-center text-sm font-semibold text-foreground-secondary hover:bg-background transition-colors"
                >
                  {t('organizer.pools.page.assignReferees')}
                </Link>
              )}
            </div>

            {/* Unassigned fighters bucket — moved into the right rail so
                it stays reachable as you scroll through pools (the rail
                is sticky). Chips stack one per row to fit the 280 px
                column; the list caps at 40vh and scrolls so the
                lifecycle actions above remain visible. */}
            {pools && pools.length > 0 && (
              <div
                className={[
                  'rounded-xl border-2 p-3 transition-colors',
                  dragging
                    ? 'border-dashed border-accent bg-accent/5'
                    : 'border-border bg-background',
                ].join(' ')}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => void handleDropOnUnassigned()}
              >
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
                    {t('organizer.pools.page.unassignedTitle')}
                  </h3>
                  <span className="text-xs text-muted">{unassigned.length}</span>
                </div>
                {unassigned.length === 0 ? (
                  <p className="text-xs text-muted italic">{t(words.unassignedEmpty)}</p>
                ) : (
                  <div className="flex max-h-[40vh] flex-col gap-1.5 overflow-y-auto">
                    {unassigned.map((u) => (
                      <div
                        key={u.sideId}
                        draggable={!isReadOnly}
                        onDragStart={() => setDragging({ seat: u, fromPoolId: UNASSIGNED_DROP_ID })}
                        onDragEnd={() => setDragging(null)}
                        className="flex items-center justify-between gap-2 bg-surface border border-border rounded-lg px-2 py-1 text-sm cursor-grab active:cursor-grabbing hover:border-border"
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-1.5 truncate">
                          <TournamentColorDot color={u.colour} />
                          <span className="font-medium text-foreground">
                            {nameOrUnknown(u.name, 'fighter', t)}
                          </span>
                          {u.clubLabel && (
                            <span className="text-muted text-xs ml-1.5">{u.clubLabel}</span>
                          )}
                        </div>
                        {u.hemaWeightedRating !== null && (
                          <span
                            className="ml-1 rounded-full bg-gold/10 px-1.5 py-0.5 text-[11px] font-bold text-gold-text shrink-0"
                            title={t('organizer.pools.page.hemaRatingTitle')}
                          >
                            {u.hemaWeightedRating.toFixed(1)}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </aside>
        </div>
      )}

      {activeTab === 'matches' && poolPhaseId && (
        <MatchesTab
          tournamentId={selectedTournament}
          poolPhaseId={poolPhaseId}
          slug={slug}
          eventId={eventId}
          isReadOnly={isReadOnly}
        />
      )}

      {activeTab === 'standings' && poolPhaseId && (
        <StandingsTab tournamentId={selectedTournament} poolPhaseId={poolPhaseId} />
      )}

      {activeTab === 'referees' && selectedTournament && (
        <RefereesTab eventId={eventId} tournamentId={selectedTournament} isReadOnly={isReadOnly} />
      )}

      <ConfirmDialog
        cancelLabel={t('actions.cancel')}
        open={pendingDeletePoolId !== null}
        title={t('organizer.pools.page.deletePoolConfirmTitle')}
        description={(() => {
          const p = (pools ?? []).find((x) => x.id === pendingDeletePoolId);
          if (!p) return t('organizer.pools.page.deletePoolFallbackDesc');
          return t('organizer.pools.page.deletePoolDesc', {
            name: p.name,
            count: p.members.length,
          });
        })()}
        confirmLabel={t('organizer.pools.page.deletePoolConfirmTitle')}
        danger
        busy={lifecycleBusy}
        onCancel={() => setPendingDeletePoolId(null)}
        onConfirm={() => void confirmDeleteOne()}
      />

      <ConfirmDialog
        cancelLabel={t('actions.cancel')}
        open={pendingDeleteAll}
        title={t('organizer.pools.page.deleteAllButton')}
        description={t('organizer.pools.page.deleteAllDesc')}
        confirmLabel={t('organizer.pools.page.deleteAllConfirm')}
        danger
        busy={lifecycleBusy}
        onCancel={() => setPendingDeleteAll(false)}
        onConfirm={() => void confirmDeleteAll()}
      />
    </main>
  );
}
