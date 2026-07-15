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

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ConfirmDialog,
  HelpTooltip,
  Modal,
  RowActionButton,
  TournamentColorDot,
  useToast,
} from '@myclash/ui';
import { useI18n } from '../../../../../../src/i18n/I18nProvider';
import { MatchesTab } from './_tabs/MatchesTab';
import { StandingsTab } from './_tabs/StandingsTab';
import { RefereesTab } from './_tabs/RefereesTab';
import { parseHashTab } from './parse-hash-tab';
import { useEventStatus } from '../_hooks/useEventStatus';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PoolMember {
  registrationId: string;
  personName: string;
  clubLabel: string | null;
  seed: number;
  hemaWeightedRating: number | null;
}

interface Pool {
  id: string;
  name: string;
  members: PoolMember[];
}

interface PoolsResponse {
  phaseId: string | null;
  visibility: 'hidden' | 'published';
  pools: Pool[];
}

interface UnassignedFighter {
  registrationId: string;
  personName: string;
  clubLabel: string | null;
  hemaWeightedRating: number | null;
}

const UNASSIGNED_DROP_ID = '__unassigned__';

interface Conflict {
  personName: string;
  fightingMatchLabel: string;
  refereeingMatchLabel: string;
  confirmed: boolean;
}

interface ConflictResult {
  conflicts: Conflict[];
  hasConfirmedConflicts: boolean;
  hasPotentialConflicts: boolean;
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
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
  const { t } = useI18n();
  const { isReadOnly } = useEventStatus(eventId);

  const [tournaments, setTournaments] = useState<
    Array<{ id: string; name: string; color?: string | null }>
  >([]);
  const [selectedTournament, setSelectedTournament] = useState<string>('');
  // Derived: the row matching the active id, surfaced to the
  // breadcrumb + picker so the tournament name follows the operator
  // across every subtab without threading a new prop.
  const selectedTournamentObj = tournaments.find((t) => t.id === selectedTournament) ?? null;
  const [pools, setPools] = useState<Pool[] | null>(null);
  const [poolPhaseId, setPoolPhaseId] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<ConflictResult | null>(null);

  // Config
  const [mode, setMode] = useState<'poolCount' | 'targetSize'>('targetSize');
  const [poolCount, setPoolCount] = useState(4);
  const [targetSize, setTargetSize] = useState(8);
  const [schoolSep, setSchoolSep] = useState(true);
  const [skillBalance, setSkillBalance] = useState(true);

  // UI state
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForceConfirm, setShowForceConfirm] = useState(false);
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

  // Drag state. fromPoolId === UNASSIGNED_DROP_ID means the fighter is dragged
  // from the unassigned bucket (no source pool delete needed).
  const [dragging, setDragging] = useState<{
    memberId: string;
    fromPoolId: string;
  } | null>(null);

  // Unassigned bucket + member editing state
  const [unassigned, setUnassigned] = useState<UnassignedFighter[]>([]);
  const [editBusy, setEditBusy] = useState(false);
  const [lockBanner, setLockBanner] = useState<string | null>(null);
  const [renamingPoolId, setRenamingPoolId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [renameBusy, setRenameBusy] = useState(false);

  // ── Load tournaments ────────────────────────────────────────────────────────

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/events/${eventId}/tournaments`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) return;
        const t = (await res.json()) as Array<{ id: string; name: string }>;
        setTournaments(t);
        if (t.length > 0) setTimeout(() => setSelectedTournament(t[0]!.id), 0);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [eventId, apiUrl]);

  // ── Load existing pools ─────────────────────────────────────────────────────

  async function loadPools(tournamentId: string, signal?: AbortSignal) {
    const [poolsRes, unassignedRes] = await Promise.all([
      fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}/pools`, {
        credentials: 'include',
        signal,
      }),
      fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}/unassigned-fighters`, {
        credentials: 'include',
        signal,
      }),
    ]);

    if (poolsRes.ok) {
      const data = (await poolsRes.json()) as Pool[] | PoolsResponse;
      const nextPools = Array.isArray(data) ? data : data.pools;
      if (!Array.isArray(data)) {
        setPoolPhaseId(data.phaseId);
      }
      setPools(nextPools);
      setExistingPhase(nextPools.length > 0);
    }

    if (unassignedRes.ok) {
      setUnassigned((await unassignedRes.json()) as UnassignedFighter[]);
    }
  }

  useEffect(() => {
    if (!selectedTournament) return;
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch lifecycle: loadPools sets state only after the awaited request resolves
    void loadPools(selectedTournament, controller.signal).catch(() => undefined);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTournament, apiUrl]);

  // ── Generate pools ──────────────────────────────────────────────────────────

  async function generate(force = false) {
    if (!selectedTournament) return;
    setGenerating(true);
    setError(null);
    setShowForceConfirm(false);

    try {
      const body: Record<string, unknown> = {
        enforceSchoolSeparation: schoolSep,
        enforceSkillBalance: skillBalance,
      };
      if (mode === 'poolCount') body['poolCount'] = poolCount;
      else body['targetSize'] = targetSize;

      const res = await fetch(
        `${apiUrl}/api/v1/tournaments/${selectedTournament}/generate-pools${force ? '?force=true' : ''}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(body),
        },
      );

      if (res.status === 409) {
        setShowForceConfirm(true);
        return;
      }

      if (!res.ok) {
        // Try hard to surface the real server message — both the structured
        // Nest field and any raw string body. Anything is better than the
        // previous silent "Generation failed".
        const body2 = (await res.json().catch(() => null)) as {
          message?: string | string[];
        } | null;
        const message = Array.isArray(body2?.message)
          ? body2!.message.join(', ')
          : (body2?.message ?? t('admin.common.poolGenerationFailedHttp', { status: res.status }));
        throw new Error(message);
      }

      // Discard the generate response body; the GET endpoint is the source of
      // truth for the full Pool[] shape (members included). Re-fetching here
      // avoids the "matchCount only" summary that the generate POST returns.
      await res.json().catch(() => undefined);
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
      const res = await fetch(`${apiUrl}/api/v1/pools/${pendingDeletePoolId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok && res.status !== 204) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? t('admin.common.couldNotDeletePool'));
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
      const res = await fetch(`${apiUrl}/api/v1/tournaments/${selectedTournament}/pools`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok && res.status !== 204) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? t('admin.common.couldNotClearPoolLayout'));
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
      const res = await fetch(`${apiUrl}/api/v1/tournaments/${selectedTournament}/pools/empty`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? t('admin.common.couldNotAddEmptyPool'));
      }
      const created = (await res.json()) as { id: string; name: string; sortOrder: number };
      toast.success(t('admin.common.poolAddedToast', { name: created.name }));
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

  async function checkConflicts() {
    if (!selectedTournament) return;
    const res = await fetch(`${apiUrl}/api/v1/tournaments/${selectedTournament}/conflict-check`, {
      credentials: 'include',
    });
    if (res.ok) setConflicts((await res.json()) as ConflictResult);
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

  async function handlePoolEditResponse(res: Response): Promise<boolean> {
    if (res.ok) {
      setLockBanner(null);
      return true;
    }
    if (res.status === 409) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      setLockBanner(body.message ?? t('admin.common.poolLockedScoringStarted'));
      return false;
    }
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    setError(body.message ?? t('organizer.phaseVisibility.updateError'));
    return false;
  }

  async function moveMemberToPool(registrationId: string, toPoolId: string) {
    setEditBusy(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/pools/${toPoolId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ registrationId }),
      });
      const ok = await handlePoolEditResponse(res);
      if (ok) {
        await loadPools(selectedTournament);
        await checkConflicts();
      }
    } finally {
      setEditBusy(false);
    }
  }

  async function removeMemberFromPool(fromPoolId: string, registrationId: string) {
    setEditBusy(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/pools/${fromPoolId}/members/${registrationId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const ok = await handlePoolEditResponse(res);
      if (ok) {
        await loadPools(selectedTournament);
        await checkConflicts();
      }
    } finally {
      setEditBusy(false);
    }
  }

  async function handleDrop(toPoolId: string) {
    if (!dragging) return;
    const { memberId, fromPoolId } = dragging;
    setDragging(null);
    if (fromPoolId === toPoolId) return;
    await moveMemberToPool(memberId, toPoolId);
  }

  async function handleDropOnUnassigned() {
    if (!dragging) return;
    const { memberId, fromPoolId } = dragging;
    setDragging(null);
    if (fromPoolId === UNASSIGNED_DROP_ID) return;
    await removeMemberFromPool(fromPoolId, memberId);
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
      const res = await fetch(`${apiUrl}/api/v1/pools/${poolId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: next }),
      });
      const ok = await handlePoolEditResponse(res);
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
            <Link href={`/org/${slug}`} className="hover:text-foreground-secondary">
              {slug}
            </Link>
            <span>/</span>
            <Link
              href={`/org/${slug}/events/${eventId}`}
              className="hover:text-foreground-secondary"
            >
              {t('organizer.phaseVisibility.breadcrumbEvent')}
            </Link>
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
          href={`/org/${slug}/events/${eventId}/bracket`}
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

            {/* Fighter/referee conflict banner */}
            {conflicts && (conflicts.hasConfirmedConflicts || conflicts.hasPotentialConflicts) && (
              <div
                className={[
                  'border rounded-xl px-4 py-3 text-sm',
                  conflicts.hasConfirmedConflicts
                    ? 'bg-danger/10 border-danger/30 text-danger'
                    : 'bg-warning/10 border-warning/30 text-warning',
                ].join(' ')}
              >
                <p className="font-bold mb-1">
                  {conflicts.hasConfirmedConflicts
                    ? t('organizer.pools.page.conflictsConfirmedTitle')
                    : t('organizer.pools.page.conflictsPotentialTitle')}
                </p>
                <ul className="list-disc list-inside space-y-0.5">
                  {conflicts.conflicts.map((c, i) => (
                    <li key={i}>
                      <strong>{c.personName}</strong>{' '}
                      {t('organizer.pools.page.conflictSegFightsIn')}{' '}
                      <em>{c.fightingMatchLabel}</em>{' '}
                      {t('organizer.pools.page.conflictSegAndReferees')}{' '}
                      <em>{c.refereeingMatchLabel}</em>
                      {!c.confirmed && <> {t('organizer.pools.page.conflictSegUnscheduled')}</>}
                    </li>
                  ))}
                </ul>
                {conflicts.hasConfirmedConflicts && (
                  <p className="mt-2 font-medium">
                    {t('organizer.pools.page.conflictsReassignHint')}
                  </p>
                )}
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

            {/* Force regenerate confirmation */}
            <Modal
              open={showForceConfirm}
              onClose={() => setShowForceConfirm(false)}
              size="sm"
              title={t('organizer.pools.page.regenerateConfirmTitle')}
              footer={
                <>
                  <button
                    onClick={() => setShowForceConfirm(false)}
                    className="px-4 py-2 border border-border rounded-lg text-sm text-foreground-secondary hover:bg-background"
                  >
                    {t('organizer.pools.page.cancel')}
                  </button>
                  <button
                    onClick={() => void generate(true)}
                    className="px-4 py-2 bg-danger hover:bg-danger-hover text-danger-foreground font-semibold rounded-lg text-sm"
                  >
                    {t('organizer.pools.page.regenerateConfirmYes')}
                  </button>
                </>
              }
            >
              <div className="text-center">
                <p className="text-4xl mb-3">⚠️</p>
                <p className="text-muted text-sm">
                  {t('organizer.pools.page.regenerateConfirmBody')}
                </p>
              </div>
            </Modal>

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
                            title={t('organizer.pools.page.renameTitle')}
                            className="self-start font-bold text-foreground hover:text-accent hover:underline decoration-dotted"
                          >
                            {pool.name}
                          </button>
                        )}
                        <span className="text-xs text-muted">
                          {pool.members.length === 1
                            ? t('organizer.pools.page.fightersCountSingular', {
                                count: pool.members.length,
                              })
                            : t('organizer.pools.page.fightersCountPlural', {
                                count: pool.members.length,
                              })}
                        </span>
                      </div>
                      <RowActionButton
                        variant="danger"
                        onClick={() => setPendingDeletePoolId(pool.id)}
                        disabled={lifecycleBusy || renamingPoolId === pool.id}
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
                          key={m.registrationId}
                          draggable
                          onDragStart={() =>
                            setDragging({ memberId: m.registrationId, fromPoolId: pool.id })
                          }
                          onDragEnd={() => setDragging(null)}
                          className="group inline-flex items-center gap-1.5 max-w-full bg-surface border border-border rounded-lg px-2 py-1 text-sm cursor-grab active:cursor-grabbing hover:border-border transition-colors"
                        >
                          <span className="font-medium text-foreground truncate max-w-[12rem]">
                            {m.personName}
                          </span>
                          {m.clubLabel && (
                            <span className="text-muted text-xs truncate max-w-[8rem]">
                              {m.clubLabel}
                            </span>
                          )}
                          {m.hemaWeightedRating !== null && (
                            <span
                              className="rounded-full bg-gold/10 px-2 py-0.5 text-[11px] font-bold text-gold"
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
                            disabled={editBusy}
                            onClick={() => void removeMemberFromPool(pool.id, m.registrationId)}
                            title={t('organizer.pools.page.moveToUnassignedTitle')}
                            className="opacity-0 group-hover:opacity-100 transition-opacity rounded p-0.5 text-muted hover:bg-danger/10 hover:text-danger disabled:opacity-30"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                      {pool.members.length === 0 && (
                        <p className="text-xs text-muted italic">
                          {t('organizer.pools.page.dropFightersHere')}
                        </p>
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
                    ? t('organizer.pools.page.fightersPerPool')
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
                      return t(
                        count > 1
                          ? 'organizer.pools.page.previewEmptyPlural'
                          : 'organizer.pools.page.previewEmptySingular',
                        { count },
                      );
                    }
                    const avg = Math.round(fighters / count);
                    return t(
                      count > 1
                        ? 'organizer.pools.page.previewPoolsPlural'
                        : 'organizer.pools.page.previewPoolsSingular',
                      { count, avg, total: fighters },
                    );
                  })()}
                </p>
              )}
            </div>

            {/* Constraints section: pool generation constraints */}
            <div className="space-y-3 border-t border-border pt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
                {t('organizer.pools.configure.constraints')}
              </h3>

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
            </div>

            {/* Lifecycle actions */}
            <div className="space-y-2 border-t border-border pt-4">
              <button
                onClick={() => void generate(false)}
                disabled={generating || !selectedTournament}
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
                disabled={lifecycleBusy || !selectedTournament}
                className="w-full rounded-lg border border-border bg-surface px-4 py-2 text-sm font-semibold text-foreground-secondary hover:bg-background disabled:opacity-50 transition-colors"
              >
                {t('organizer.pools.page.addEmptyPool')}
              </button>
              <button
                type="button"
                onClick={() => setPendingDeleteAll(true)}
                disabled={lifecycleBusy || !existingPhase || !selectedTournament}
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
                  <p className="text-xs text-muted italic">
                    {t('organizer.pools.page.unassignedEmpty')}
                  </p>
                ) : (
                  <div className="flex max-h-[40vh] flex-col gap-1.5 overflow-y-auto">
                    {unassigned.map((u) => (
                      <div
                        key={u.registrationId}
                        draggable
                        onDragStart={() =>
                          setDragging({
                            memberId: u.registrationId,
                            fromPoolId: UNASSIGNED_DROP_ID,
                          })
                        }
                        onDragEnd={() => setDragging(null)}
                        className="flex items-center justify-between gap-2 bg-surface border border-border rounded-lg px-2 py-1 text-sm cursor-grab active:cursor-grabbing hover:border-border"
                      >
                        <div className="min-w-0 flex-1 truncate">
                          <span className="font-medium text-foreground">{u.personName}</span>
                          {u.clubLabel && (
                            <span className="text-muted text-xs ml-1.5">{u.clubLabel}</span>
                          )}
                        </div>
                        {u.hemaWeightedRating !== null && (
                          <span
                            className="ml-1 rounded-full bg-gold/10 px-1.5 py-0.5 text-[11px] font-bold text-gold shrink-0"
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
        />
      )}

      {activeTab === 'standings' && poolPhaseId && (
        <StandingsTab tournamentId={selectedTournament} poolPhaseId={poolPhaseId} />
      )}

      {activeTab === 'referees' && selectedTournament && (
        <RefereesTab eventId={eventId} tournamentId={selectedTournament} isReadOnly={isReadOnly} />
      )}

      <ConfirmDialog
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
