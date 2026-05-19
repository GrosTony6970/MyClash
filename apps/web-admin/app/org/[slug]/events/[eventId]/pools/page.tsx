'use client';

/* eslint-disable myclash/no-literal-string */

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

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useI18n } from '../../../../../../src/i18n/I18nProvider';

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

// ── Component ─────────────────────────────────────────────────────────────────

export default function PoolsPage() {
  const params = useParams<{ slug: string; eventId: string }>();
  const { slug, eventId } = params;
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
  const { t } = useI18n();

  const [tournaments, setTournaments] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedTournament, setSelectedTournament] = useState<string>('');
  const [pools, setPools] = useState<Pool[] | null>(null);
  const [poolPhaseId, setPoolPhaseId] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<'hidden' | 'published'>('hidden');
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
  const [visibilityBusy, setVisibilityBusy] = useState(false);
  const [showForceConfirm, setShowForceConfirm] = useState(false);
  const [showUnpublishConfirm, setShowUnpublishConfirm] = useState(false);
  const [notifyHref, setNotifyHref] = useState<string | null>(null);
  const [existingPhase, setExistingPhase] = useState(false);

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
        setVisibility(data.visibility);
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
        const body2 = (await res.json()) as { message?: string };
        throw new Error(body2.message ?? 'Generation failed');
      }

      // Discard the generate response body; the GET endpoint is the source of
      // truth for the full Pool[] shape (members included). Re-fetching here
      // avoids the "matchCount only" summary that the generate POST returns.
      await res.json().catch(() => undefined);
      setVisibility('hidden');
      setNotifyHref(null);
      setExistingPhase(true);
      await loadPools(selectedTournament);

      // Check conflicts
      await checkConflicts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setGenerating(false);
    }
  }

  async function checkConflicts() {
    if (!selectedTournament) return;
    const res = await fetch(`${apiUrl}/api/v1/tournaments/${selectedTournament}/conflict-check`, {
      credentials: 'include',
    });
    if (res.ok) setConflicts((await res.json()) as ConflictResult);
  }

  async function updateVisibility(nextVisibility: 'hidden' | 'published', confirmStarted = false) {
    if (!poolPhaseId || visibilityBusy) return;
    setVisibilityBusy(true);
    setError(null);
    setShowUnpublishConfirm(false);
    try {
      const res = await fetch(`${apiUrl}/api/v1/phases/${poolPhaseId}/visibility`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ visibility: nextVisibility, confirmStarted }),
      });
      if (res.status === 409 && nextVisibility === 'hidden') {
        setShowUnpublishConfirm(true);
        return;
      }
      if (!res.ok) {
        const body2 = (await res.json()) as { message?: string };
        throw new Error(body2.message ?? t('organizer.phaseVisibility.updateError'));
      }
      setVisibility(nextVisibility);
      if (nextVisibility === 'published') {
        const query = new URLSearchParams({
          targetType: 'fighters_and_referees',
          severity: 'info',
          tournamentId: selectedTournament,
          title: t('organizer.phaseVisibility.poolsReadyTitle'),
          body: t('organizer.phaseVisibility.poolsReadyBody'),
        });
        setNotifyHref(`/org/${slug}/events/${eventId}/notifications?${query.toString()}`);
      } else {
        setNotifyHref(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('organizer.phaseVisibility.updateError'));
    } finally {
      setVisibilityBusy(false);
    }
  }

  // ── Drag-drop pool member edit ──────────────────────────────────────────────

  async function handlePoolEditResponse(res: Response): Promise<boolean> {
    if (res.ok) {
      setLockBanner(null);
      return true;
    }
    if (res.status === 409) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      setLockBanner(
        body.message ?? 'Pool is locked because scoring has started in at least one match.',
      );
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
    <main className="p-8 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <Link href={`/org/${slug}`} className="hover:text-gray-700">
              {slug}
            </Link>
            <span>/</span>
            <Link href={`/org/${slug}/events/${eventId}`} className="hover:text-gray-700">
              {t('organizer.phaseVisibility.breadcrumbEvent')}
            </Link>
            <span>/</span>
            <span className="text-gray-900 font-medium">
              {t('organizer.phaseVisibility.breadcrumbPools')}
            </span>
          </div>
          <h1 className="text-2xl font-bold">{t('organizer.phaseVisibility.poolsTitle')}</h1>
        </div>
        <Link
          href={`/org/${slug}/events/${eventId}/ai-assistant?type=pool_plan${selectedTournament ? `&tournamentId=${selectedTournament}` : ''}`}
          className="border border-gray-300 hover:border-gray-400 text-gray-700 font-medium py-2 px-4 rounded-lg text-sm transition-colors"
        >
          {t('organizer.aiAssistant.suggest')}
        </Link>
        <Link
          href={`/org/${slug}/events/${eventId}/bracket`}
          className="border border-gray-300 hover:border-gray-400 text-gray-700 font-medium py-2 px-4 rounded-lg text-sm transition-colors"
        >
          Bracket →
        </Link>
      </div>

      {/* Conflict warning — hard constraint */}
      {poolPhaseId && (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white p-4">
          <span
            className={[
              'rounded-full px-2.5 py-1 text-xs font-semibold',
              visibility === 'published'
                ? 'bg-green-100 text-green-700'
                : 'bg-gray-100 text-gray-600',
            ].join(' ')}
          >
            {visibility === 'published'
              ? t('organizer.phaseVisibility.published')
              : t('organizer.phaseVisibility.hidden')}
          </span>
          <button
            type="button"
            disabled={visibilityBusy || visibility === 'published'}
            onClick={() => void updateVisibility('published')}
            className="rounded-lg bg-red-700 px-3 py-2 text-sm font-semibold text-white disabled:bg-gray-300"
          >
            {t('organizer.phaseVisibility.publishPools')}
          </button>
          <button
            type="button"
            disabled={visibilityBusy || visibility === 'hidden'}
            onClick={() => void updateVisibility('hidden')}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 disabled:text-gray-300"
          >
            {t('organizer.phaseVisibility.unpublishPools')}
          </button>
          {notifyHref && (
            <Link href={notifyHref} className="text-sm font-semibold text-red-700 underline">
              {t('organizer.phaseVisibility.notifyParticipants')}
            </Link>
          )}
        </div>
      )}

      {showUnpublishConfirm && (
        <div className="mb-6 rounded-xl border border-yellow-300 bg-yellow-50 p-4 text-sm text-yellow-900">
          <p className="font-semibold">{t('organizer.phaseVisibility.unpublishStartedWarning')}</p>
          <button
            type="button"
            onClick={() => void updateVisibility('hidden', true)}
            className="mt-3 rounded-lg bg-yellow-600 px-3 py-2 text-sm font-semibold text-white"
          >
            {t('organizer.phaseVisibility.confirmUnpublish')}
          </button>
        </div>
      )}

      {conflicts && (conflicts.hasConfirmedConflicts || conflicts.hasPotentialConflicts) && (
        <div
          className={[
            'border rounded-xl px-4 py-3 mb-6 text-sm',
            conflicts.hasConfirmedConflicts
              ? 'bg-red-50 border-red-300 text-red-700'
              : 'bg-yellow-50 border-yellow-300 text-yellow-700',
          ].join(' ')}
        >
          <p className="font-bold mb-1">
            {conflicts.hasConfirmedConflicts
              ? '⛔ Fighter/referee conflicts detected (hard constraint)'
              : '⚠ Potential fighter/referee conflicts'}
          </p>
          <ul className="list-disc list-inside space-y-0.5">
            {conflicts.conflicts.map((c, i) => (
              <li key={i}>
                <strong>{c.personName}</strong> fights in <em>{c.fightingMatchLabel}</em> and
                referees <em>{c.refereeingMatchLabel}</em>
                {!c.confirmed && ' (unscheduled — potential conflict)'}
              </li>
            ))}
          </ul>
          {conflicts.hasConfirmedConflicts && (
            <p className="mt-2 font-medium">Reassign referees before publishing this event.</p>
          )}
        </div>
      )}

      {/* Tournament tabs */}
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
                  'px-3 py-1.5 rounded-full text-sm font-medium border transition-colors',
                  active
                    ? 'bg-red-700 text-white border-red-700'
                    : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400',
                ].join(' ')}
              >
                {tour.name}
              </button>
            );
          })}
        </div>
      )}

      {lockBanner && (
        <div className="mb-4 rounded-lg border border-yellow-300 bg-yellow-50 px-4 py-2.5 text-sm text-yellow-900">
          <strong className="font-semibold">{lockBanner}</strong>
          <span className="ml-2 text-yellow-700">
            Clear scores in the matches view to unlock the pool.
          </span>
        </div>
      )}

      {/* Config panel */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-5 mb-6">
        <h2 className="text-sm font-bold text-gray-700 mb-4">Pool configuration</h2>
        <div className="flex flex-wrap gap-6 items-start">
          {/* Mode toggle */}
          <div>
            <p className="text-xs font-medium text-gray-600 mb-2">Size mode</p>
            <div className="flex gap-2">
              <button
                onClick={() => setMode('targetSize')}
                className={[
                  'px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors',
                  mode === 'targetSize'
                    ? 'bg-red-700 text-white border-red-700'
                    : 'bg-white text-gray-700 border-gray-300',
                ].join(' ')}
              >
                Target size
              </button>
              <button
                onClick={() => setMode('poolCount')}
                className={[
                  'px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors',
                  mode === 'poolCount'
                    ? 'bg-red-700 text-white border-red-700'
                    : 'bg-white text-gray-700 border-gray-300',
                ].join(' ')}
              >
                Pool count
              </button>
            </div>
          </div>

          {/* Value */}
          <div>
            <p className="text-xs font-medium text-gray-600 mb-2">
              {mode === 'targetSize' ? 'Fighters per pool' : 'Number of pools'}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() =>
                  mode === 'targetSize'
                    ? setTargetSize((v) => Math.max(2, v - 1))
                    : setPoolCount((v) => Math.max(1, v - 1))
                }
                className="w-8 h-8 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100 font-bold"
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
                className="w-8 h-8 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100 font-bold"
              >
                +
              </button>
            </div>
          </div>

          {/* Toggles */}
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={schoolSep}
                onChange={(e) => setSchoolSep(e.target.checked)}
                className="rounded"
              />
              School separation
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={skillBalance}
                onChange={(e) => setSkillBalance(e.target.checked)}
                className="rounded"
              />
              Skill balance
            </label>
          </div>

          {/* Generate button */}
          <div className="flex items-end">
            <button
              onClick={() => void generate(false)}
              disabled={generating || !selectedTournament}
              className="bg-red-700 hover:bg-red-800 disabled:opacity-50 text-white font-semibold py-2 px-5 rounded-lg text-sm transition-colors"
            >
              {generating ? 'Generating…' : existingPhase ? 'Regenerate' : 'Generate pools'}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4 text-sm">
          {error}
        </div>
      )}

      {/* Force regenerate confirmation */}
      {showForceConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 text-center">
            <p className="text-4xl mb-3">⚠️</p>
            <h2 className="text-lg font-bold mb-2">Regenerate pools?</h2>
            <p className="text-gray-500 text-sm mb-5">
              Existing pools and all their matches will be deleted. This cannot be undone.
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => setShowForceConfirm(false)}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void generate(true)}
                className="px-4 py-2 bg-red-700 hover:bg-red-800 text-white font-semibold rounded-lg text-sm"
              >
                Yes, regenerate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pool cards with drag-drop */}
      {pools && pools.length > 0 && (
        <div className="grid grid-cols-2 gap-4">
          {pools.map((pool) => (
            <div
              key={pool.id}
              className={[
                'border-2 rounded-xl p-4 transition-colors',
                dragging ? 'border-dashed border-red-300 bg-red-50/30' : 'border-gray-200',
              ].join(' ')}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => void handleDrop(pool.id)}
            >
              <div className="mb-3 flex items-center justify-between gap-2">
                {renamingPoolId === pool.id ? (
                  <div className="flex items-center gap-2 flex-1">
                    <input
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void saveRename(pool.id);
                        if (e.key === 'Escape') setRenamingPoolId(null);
                      }}
                      autoFocus
                      className="flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                    />
                    <button
                      type="button"
                      disabled={renameBusy}
                      onClick={() => void saveRename(pool.id)}
                      className="rounded-md bg-red-700 px-3 py-1 text-xs font-semibold text-white hover:bg-red-800 disabled:opacity-50"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setRenamingPoolId(null)}
                      className="rounded-md px-3 py-1 text-xs text-gray-500 hover:text-gray-700"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => void startRename(pool)}
                    title="Rename pool"
                    className="font-bold text-gray-900 hover:text-red-700 hover:underline decoration-dotted"
                  >
                    {pool.name}
                  </button>
                )}
                <span className="text-xs text-gray-400">{pool.members.length} fighters</span>
              </div>
              <div className="flex flex-col gap-1.5">
                {pool.members.map((m) => (
                  <div
                    key={m.registrationId}
                    draggable
                    onDragStart={() =>
                      setDragging({ memberId: m.registrationId, fromPoolId: pool.id })
                    }
                    onDragEnd={() => setDragging(null)}
                    className="group flex items-center justify-between bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-sm cursor-grab active:cursor-grabbing hover:border-gray-300 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <span className="font-medium text-gray-900">{m.personName}</span>
                      {m.clubLabel && (
                        <span className="text-gray-400 text-xs ml-2">{m.clubLabel}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {m.hemaWeightedRating !== null && (
                        <span
                          className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800"
                          title="HEMA weighted rating"
                        >
                          {m.hemaWeightedRating.toFixed(1)}
                        </span>
                      )}
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-500">
                        #{m.seed}
                      </span>
                      <button
                        type="button"
                        disabled={editBusy}
                        onClick={() => void removeMemberFromPool(pool.id, m.registrationId)}
                        title="Move to unassigned"
                        className="opacity-0 group-hover:opacity-100 transition-opacity rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-700 disabled:opacity-30"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))}
                {pool.members.length === 0 && (
                  <p className="text-xs text-gray-400 italic">Drop fighters here.</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Unassigned fighters bucket */}
      {pools && pools.length > 0 && (
        <div
          className={[
            'mt-6 rounded-xl border-2 p-4 transition-colors',
            dragging ? 'border-dashed border-red-300 bg-red-50/30' : 'border-gray-200 bg-gray-50',
          ].join(' ')}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => void handleDropOnUnassigned()}
        >
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-bold text-gray-900">Unassigned fighters</h3>
            <span className="text-xs text-gray-400">{unassigned.length} fighters</span>
          </div>
          {unassigned.length === 0 ? (
            <p className="text-xs text-gray-400 italic">
              All registered fighters are in a pool. Drag a fighter here to remove them from their
              pool.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
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
                  className="flex items-center justify-between bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-sm cursor-grab active:cursor-grabbing hover:border-gray-300"
                >
                  <div className="min-w-0 flex-1">
                    <span className="font-medium text-gray-900">{u.personName}</span>
                    {u.clubLabel && (
                      <span className="text-gray-400 text-xs ml-2">{u.clubLabel}</span>
                    )}
                  </div>
                  {u.hemaWeightedRating !== null && (
                    <span
                      className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800 shrink-0"
                      title="HEMA weighted rating"
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

      {!pools && !generating && (
        <div className="text-center py-16 border-2 border-dashed border-gray-200 rounded-xl">
          <p className="text-gray-400 text-sm">
            No pools generated yet. Configure above and click Generate.
          </p>
        </div>
      )}
    </main>
  );
}
