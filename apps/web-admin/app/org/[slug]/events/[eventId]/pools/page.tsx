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

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PoolMember {
  registrationId: string;
  personName: string;
  clubLabel: string | null;
  seed: number;
}

interface Pool {
  id: string;
  name: string;
  members: PoolMember[];
}

interface GenerateResult {
  phaseId: string;
  poolCount: number;
  pools: Pool[];
  totalMatches: number;
  costReport: { sameClusters: number; skillImbalance: number } | null;
}

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

  const [tournaments, setTournaments] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedTournament, setSelectedTournament] = useState<string>('');
  const [pools, setPools] = useState<Pool[] | null>(null);
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

  // Drag state
  const [dragging, setDragging] = useState<{
    memberId: string;
    fromPoolId: string;
  } | null>(null);

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

  useEffect(() => {
    if (!selectedTournament) return;
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/tournaments/${selectedTournament}/pools`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as Pool[];
        if (data.length > 0) {
          setPools(data);
          setExistingPhase(true);
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
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

      const result = (await res.json()) as GenerateResult;
      setPools(result.pools);
      setExistingPhase(true);

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

  // ── Drag-drop pool member swap ──────────────────────────────────────────────

  async function handleDrop(toPoolId: string) {
    if (!dragging || dragging.fromPoolId === toPoolId) {
      setDragging(null);
      return;
    }

    // Optimistic UI update
    setPools((prev) => {
      if (!prev) return prev;
      const member = prev
        .find((p) => p.id === dragging.fromPoolId)
        ?.members.find((m) => m.registrationId === dragging.memberId);
      if (!member) return prev;

      return prev.map((pool) => {
        if (pool.id === dragging.fromPoolId) {
          return {
            ...pool,
            members: pool.members.filter((m) => m.registrationId !== dragging.memberId),
          };
        }
        if (pool.id === toPoolId) {
          return { ...pool, members: [...pool.members, member] };
        }
        return pool;
      });
    });

    // Persist swap
    await fetch(`${apiUrl}/api/v1/pools/${toPoolId}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ registrationId: dragging.memberId }),
    });

    setDragging(null);
    await checkConflicts();
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
              Event
            </Link>
            <span>/</span>
            <span className="text-gray-900 font-medium">Pools</span>
          </div>
          <h1 className="text-2xl font-bold">Pool management</h1>
        </div>
        <Link
          href={`/org/${slug}/events/${eventId}/bracket`}
          className="border border-gray-300 hover:border-gray-400 text-gray-700 font-medium py-2 px-4 rounded-lg text-sm transition-colors"
        >
          Bracket →
        </Link>
      </div>

      {/* Conflict warning — hard constraint */}
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

      {/* Tournament selector */}
      {tournaments.length > 1 && (
        <div className="mb-4">
          <select
            value={selectedTournament}
            onChange={(e) => setSelectedTournament(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
          >
            {tournaments.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
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
              <h3 className="font-bold text-gray-900 mb-3">{pool.name}</h3>
              <div className="flex flex-col gap-1.5">
                {pool.members.map((m) => (
                  <div
                    key={m.registrationId}
                    draggable
                    onDragStart={() =>
                      setDragging({ memberId: m.registrationId, fromPoolId: pool.id })
                    }
                    onDragEnd={() => setDragging(null)}
                    className="flex items-center justify-between bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-sm cursor-grab active:cursor-grabbing hover:border-gray-300 transition-colors"
                  >
                    <div>
                      <span className="font-medium text-gray-900">{m.personName}</span>
                      {m.clubLabel && (
                        <span className="text-gray-400 text-xs ml-2">{m.clubLabel}</span>
                      )}
                    </div>
                    <span className="text-xs text-gray-400">#{m.seed}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
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
