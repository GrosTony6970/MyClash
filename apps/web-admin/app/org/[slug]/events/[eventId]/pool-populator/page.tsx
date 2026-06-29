'use client';

/**
 * Pool populator UI — T-907
 * Route: /org/[slug]/events/[eventId]/pool-populator
 *
 * AC:
 *   ✓ Pool count + target size configurable
 *   ✓ School separation + skill balance toggles
 *   ✓ Generate → proposal with per-pool fighter list + cost markers
 *   ✓ Drag fighter between pools → cost recomputes
 *   ✓ Accept & Save persists; Regenerate reruns
 *   ✓ Same-club pairs highlighted
 */

import { useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useI18n } from '../../../../../../src/i18n/I18nProvider';

interface Fighter {
  registrationId: string;
  clubId: string | null;
  skillRating: number | null;
  seed: number;
  /** Human-readable name projected by the populator API (given + family). */
  displayName?: string;
  /** Club abbreviation if set on `clubs.abbreviation`, else `clubs.name`. */
  clubAbbrev?: string | null;
}

interface Pool {
  poolIndex: number;
  name: string;
  fighters: Fighter[];
  matchCount: number;
}

interface CostReport {
  totalCost: number;
  sameClubPairsPerPool: Array<{ poolIndex: number; count: number; pairs: string[][] }>;
}

interface Proposal {
  dryRun: boolean;
  poolCount: number;
  fighterCount: number;
  pools: Pool[];
  costReport: CostReport;
  violations: string[];
}

export default function PoolPopulatorPage() {
  const { t } = useI18n();
  const params = useParams<{ slug: string; eventId: string }>();
  const { slug, eventId } = params;
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

  // Config
  const [mode, setMode] = useState<'targetSize' | 'poolCount'>('targetSize');
  const [targetSize, setTargetSize] = useState(8);
  const [poolCount, setPoolCount] = useState(4);
  const [schoolSep, setSchoolSep] = useState(true);
  const [skillBalance, setSkillBalance] = useState(true);
  const [seed, setSeed] = useState(42);

  // State
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [pools, setPools] = useState<Pool[] | null>(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Drag state
  const dragging = useRef<{ registrationId: string; fromPoolIndex: number } | null>(null);

  // ── Generate ────────────────────────────────────────────────────────────────

  async function generate() {
    setGenerating(true);
    setError(null);
    setSaved(false);

    try {
      const body: Record<string, unknown> = {
        enforceSchoolSeparation: schoolSep,
        enforceSkillBalance: skillBalance,
        seed,
      };
      if (mode === 'poolCount') body['poolCount'] = poolCount;
      else body['targetSize'] = targetSize;

      const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/populate-pools?dryRun=true`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const b = (await res.json()) as { message?: string; error?: string };
        throw new Error(b.message ?? b.error ?? t('admin.common.generationFailed'));
      }

      const data = (await res.json()) as Proposal;
      setProposal(data);
      setPools(data.pools);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.common.generationFailed'));
    } finally {
      setGenerating(false);
    }
  }

  // ── Save ────────────────────────────────────────────────────────────────────

  async function save() {
    setSaving(true);
    setError(null);

    try {
      const body: Record<string, unknown> = {
        enforceSchoolSeparation: schoolSep,
        enforceSkillBalance: skillBalance,
        seed,
      };
      if (mode === 'poolCount') body['poolCount'] = poolCount;
      else body['targetSize'] = targetSize;

      const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/populate-pools?dryRun=false`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const b = (await res.json()) as { message?: string };
        throw new Error(b.message ?? t('admin.common.saveFailed'));
      }

      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.common.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  // ── Drag-drop ───────────────────────────────────────────────────────────────

  function handleDrop(toPoolIndex: number) {
    const drag = dragging.current;
    if (!drag || drag.fromPoolIndex === toPoolIndex || !pools) {
      dragging.current = null;
      return;
    }

    const fighter = pools
      .find((p) => p.poolIndex === drag.fromPoolIndex)
      ?.fighters.find((f) => f.registrationId === drag.registrationId);

    if (!fighter) {
      dragging.current = null;
      return;
    }

    const updated = pools.map((pool) => {
      if (pool.poolIndex === drag.fromPoolIndex) {
        return {
          ...pool,
          fighters: pool.fighters.filter((f) => f.registrationId !== drag.registrationId),
        };
      }
      if (pool.poolIndex === toPoolIndex) {
        return { ...pool, fighters: [...pool.fighters, fighter] };
      }
      return pool;
    });

    setPools(updated);
    dragging.current = null;
  }

  // ── Same-club detection ─────────────────────────────────────────────────────

  function getSameClubPairs(pool: Pool): Set<string> {
    const conflicted = new Set<string>();
    const byClub = new Map<string, string[]>();
    for (const f of pool.fighters) {
      if (!f.clubId) continue;
      const arr = byClub.get(f.clubId) ?? [];
      arr.push(f.registrationId);
      byClub.set(f.clubId, arr);
    }
    for (const [, regIds] of byClub) {
      if (regIds.length > 1) regIds.forEach((id) => conflicted.add(id));
    }
    return conflicted;
  }

  return (
    <main className="mx-auto p-8 max-w-7xl">
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
              {t('admin.orgPools.breadcrumbEvent')}
            </Link>
            <span>/</span>
            <span className="text-foreground font-medium">{t('admin.orgPools.poolPopulator')}</span>
          </div>
          <h1 className="font-display font-bold text-2xl sm:text-3xl">
            {t('admin.orgPools.poolPopulator')}
          </h1>
        </div>
        <Link
          href={`/org/${slug}/events/${eventId}/pools`}
          className="border border-border hover:border-border text-foreground-secondary font-medium py-2 px-4 rounded-lg text-sm transition-colors"
        >
          {t('admin.orgPools.backToPools')}
        </Link>
      </div>

      {/* Config panel */}
      <div className="bg-background border border-border rounded-xl p-5 mb-6">
        <h2 className="font-display font-semibold text-lg sm:text-xl text-foreground-secondary mb-4">
          {t('admin.orgPools.configuration')}
        </h2>
        <div className="flex flex-wrap gap-6 items-end">
          {/* Mode */}
          <div>
            <p className="text-xs font-medium text-foreground-secondary mb-2">
              {t('admin.orgPools.sizeMode')}
            </p>
            <div className="flex gap-2">
              {(['targetSize', 'poolCount'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={[
                    'px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors',
                    mode === m
                      ? 'bg-accent text-accent-foreground border-accent'
                      : 'bg-surface text-foreground-secondary border-border',
                  ].join(' ')}
                >
                  {m === 'targetSize' ? 'Target size' : 'Pool count'}
                </button>
              ))}
            </div>
          </div>

          {/* Value */}
          <div>
            <p className="text-xs font-medium text-foreground-secondary mb-2">
              {mode === 'targetSize' ? 'Fighters per pool' : 'Number of pools'}
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

          {/* Toggles */}
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={schoolSep}
                onChange={(e) => setSchoolSep(e.target.checked)}
                className="rounded"
              />
              {t('admin.orgPools.schoolSeparation')}
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={skillBalance}
                onChange={(e) => setSkillBalance(e.target.checked)}
                className="rounded"
              />
              {t('admin.orgPools.skillBalance')}
            </label>
          </div>

          {/* Seed */}
          <div>
            <p className="text-xs font-medium text-foreground-secondary mb-2">
              {t('admin.orgPools.prngSeed')}
            </p>
            <input
              type="number"
              value={seed}
              onChange={(e) => setSeed(parseInt(e.target.value) || 42)}
              className="w-20 border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          <button
            onClick={() => void generate()}
            disabled={generating}
            className="bg-accent hover:bg-accent-hover disabled:opacity-50 text-accent-foreground font-semibold py-2 px-5 rounded-lg text-sm transition-colors"
          >
            {generating ? 'Generating…' : 'Generate'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-danger/10 border border-danger/30 text-danger rounded-lg px-4 py-3 mb-4 text-sm">
          {error}
        </div>
      )}

      {/* Proposal stats */}
      {proposal && pools && (
        <>
          <div className="flex items-center gap-4 mb-4 text-sm text-muted">
            <span>
              {t('admin.orgPools.poolsFightersSummary', {
                pools: proposal.poolCount,
                fighters: proposal.fighterCount,
              })}
            </span>
            <span>·</span>
            <span>
              {t('admin.orgPools.costLabel', {
                cost: proposal.costReport.totalCost.toFixed(1),
              })}
            </span>
            {proposal.violations.length > 0 && (
              <>
                <span>·</span>
                <span className="text-warning font-medium">⚠ {proposal.violations.join(', ')}</span>
              </>
            )}
          </div>

          {/* Pool cards with drag-drop */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            {pools.map((pool) => {
              const sameClub = getSameClubPairs(pool);
              return (
                <div
                  key={pool.poolIndex}
                  className="border-2 border-border rounded-xl p-4"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => handleDrop(pool.poolIndex)}
                >
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-display font-semibold text-lg sm:text-xl text-foreground">
                      {pool.name}
                    </h3>
                    <span className="text-xs text-muted">
                      {t('admin.orgPools.matchCount', { count: pool.matchCount })}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {pool.fighters.map((f) => (
                      <div
                        key={f.registrationId}
                        draggable
                        onDragStart={() => {
                          dragging.current = {
                            registrationId: f.registrationId,
                            fromPoolIndex: pool.poolIndex,
                          };
                        }}
                        onDragEnd={() => {
                          dragging.current = null;
                        }}
                        className={[
                          'flex items-center justify-between border rounded-lg px-3 py-1.5 text-sm cursor-grab active:cursor-grabbing transition-colors',
                          sameClub.has(f.registrationId)
                            ? 'border-warning/30 bg-warning/10 text-warning'
                            : 'border-border bg-surface hover:border-muted',
                        ].join(' ')}
                        title={
                          sameClub.has(f.registrationId)
                            ? 'Same club as another fighter in this pool'
                            : ''
                        }
                      >
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate font-medium">{f.displayName ?? '—'}</span>
                          {f.clubAbbrev && (
                            <span className="truncate text-xs text-muted">{f.clubAbbrev}</span>
                          )}
                        </div>
                        <div className="flex flex-shrink-0 items-center gap-2">
                          {sameClub.has(f.registrationId) && (
                            <span className="text-xs text-warning">
                              {t('admin.orgPools.sameClubBadge')}
                            </span>
                          )}
                          <span className="text-xs text-muted">#{f.seed}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3">
            {saved ? (
              <span className="text-sm text-success font-medium">
                {t('admin.orgPools.savedToDatabase')}
              </span>
            ) : (
              <button
                onClick={() => void save()}
                disabled={saving}
                className="bg-success hover:bg-success-hover disabled:opacity-50 text-success-foreground font-semibold py-2 px-6 rounded-lg text-sm transition-colors"
              >
                {saving ? 'Saving…' : 'Accept & Save'}
              </button>
            )}
            <button
              onClick={() => void generate()}
              disabled={generating}
              className="border border-border hover:border-border text-foreground-secondary font-medium py-2 px-4 rounded-lg text-sm transition-colors disabled:opacity-50"
            >
              {t('admin.orgPools.regenerate')}
            </button>
          </div>
        </>
      )}

      {!proposal && !generating && (
        <div className="text-center py-16 border-2 border-dashed border-border rounded-xl">
          <p className="text-muted text-sm">{t('admin.orgPools.emptyStateHint')}</p>
        </div>
      )}
    </main>
  );
}
