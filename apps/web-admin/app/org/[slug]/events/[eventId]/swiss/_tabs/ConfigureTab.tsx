'use client';

/**
 * Generate a Swiss phase, then configure it.
 *
 * One form for both states. Before generation the fields are the POST body;
 * after it they are a PATCH, and the three the API freezes once round 2 exists
 * (`pairingMethod`, `points`, `grouping`) render disabled with the reason —
 * changing them retroactively rewrites what the rounds already played were
 * worth, so a 409 here would be the operator discovering the rule the hard way.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { t } from '@myclash/i18n';
import { ConfirmDialog, useToast } from '@myclash/ui';
import { getPublicApiUrl } from '@/lib/api-url';
import {
  swissMutate,
  type SwissConfig,
  type SwissGrouping,
  type SwissPoints,
  type UseSwissAdmin,
} from '../useSwissAdmin';
import { GroupingField, type BandPreviewPlayer } from '../_components/GroupingField';
import { LifecyclePanel, WithdrawPanel } from '../_components/LifecyclePanel';
import { FormatSection } from '../_components/FormatSection';
import { TiebreakChainField } from '../_components/TiebreakChainField';

export interface Draft {
  roundCount: number;
  seedingStrategy: 'random' | 'by-rating' | 'by-pool-rank';
  sourcePhaseId: string | null;
  pairingMethod: 'fold' | 'adjacent';
  grouping: SwissGrouping;
  rankBy: 'swissPts' | 'rulesetScore';
  points: SwissPoints;
  tiebreakChain: string[];
  minRatingCoveragePercent: number | null;
}

export function ConfigureTab({
  tournamentId,
  swiss,
  isReadOnly,
  slug,
  eventId,
}: {
  tournamentId: string;
  swiss: UseSwissAdmin;
  isReadOnly: boolean;
  slug: string;
  eventId: string;
}) {
  const toast = useToast();
  const { view, reload } = swiss;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [standings, setStandings] = useState<BandPreviewPlayer[]>([]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- seeds the form from the freshly-loaded view
    if (view) setDraft(draftFrom(view.config, view.recommendedRoundCount));
  }, [view]);

  // The live band preview reads the SAME scores the pairing would.
  useEffect(() => {
    if (!view?.phaseId) return;
    const controller = new AbortController();
    void fetch(`${getPublicApiUrl()}/api/v1/tournaments/${tournamentId}/swiss-standings`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => (res.ok ? ((await res.json()) as StandingsPayload) : null))
      .then((data) => {
        setStandings(
          (data?.rows ?? []).map((row) => ({
            registrationId: row.registrationId,
            displayName: row.displayName,
            score: Number(row.stats['score'] ?? 0),
          })),
        );
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [tournamentId, view?.phaseId]);

  if (!view || !draft) return <p className="text-sm text-muted">{t('common.loading')}</p>;

  const hasPhase = view.phaseId !== null;
  const roundsGenerated = view.rounds.length;
  const frozen = roundsGenerated > 1;
  const finalized = Boolean(view.config?.finalized);
  const locked = isReadOnly || finalized;

  async function run(label: string, fn: () => ReturnType<typeof swissMutate>) {
    setBusy(true);
    try {
      const result = await fn();
      if (!result.ok) {
        toast.error(result.message);
        return false;
      }
      toast.success(label);
      await reload();
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function generate(force: boolean) {
    setConfirmRegenerate(false);
    const ok = await run(t('organizer.swiss.configure.generated'), () =>
      swissMutate(`/tournaments/${tournamentId}/generate-swiss${force ? '?force=true' : ''}`, {
        method: 'POST',
        body: {
          roundCount: draft!.roundCount,
          seedingStrategy: draft!.seedingStrategy,
          sourcePhaseId: draft!.sourcePhaseId,
          pairingMethod: draft!.pairingMethod,
          grouping: draft!.grouping,
          rankBy: draft!.rankBy,
          points: draft!.points,
          tiebreakChain: draft!.tiebreakChain,
          minRatingCoveragePercent: draft!.minRatingCoveragePercent,
        },
      }),
    );
    if (ok) window.location.hash = '#rounds';
  }

  async function save() {
    await run(t('organizer.swiss.configure.saved'), () =>
      swissMutate(`/swiss-phases/${view!.phaseId}/config`, {
        method: 'PATCH',
        body: {
          roundCount: draft!.roundCount,
          rankBy: draft!.rankBy,
          tiebreakChain: draft!.tiebreakChain,
          minRatingCoveragePercent: draft!.minRatingCoveragePercent,
          // Only sent while still editable — the API refuses them past round 2
          // and this form disables them, so sending them anyway would 409 on a
          // value the operator never touched.
          ...(frozen
            ? {}
            : {
                pairingMethod: draft!.pairingMethod,
                grouping: draft!.grouping,
                points: draft!.points,
              }),
        },
      }),
    );
  }

  const frozenReason = frozen ? t('organizer.swiss.configure.frozenAfterRound2') : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        <FormatSection
          draft={draft}
          view={view}
          hasPhase={hasPhase}
          locked={locked}
          frozen={frozen}
          frozenReason={frozenReason}
          onChange={setDraft}
        />

        <GroupingField
          grouping={draft.grouping}
          players={standings}
          disabled={locked || frozen}
          disabledReason={frozenReason}
          onChange={(grouping) => setDraft({ ...draft, grouping })}
        />

        <section className="space-y-3 rounded-lg border border-border bg-surface p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
            {t('organizer.swiss.configure.rankingTitle')}
          </h2>
          <p className="text-xs text-foreground-secondary">
            {t('organizer.swiss.configure.rankingExplainer')}
          </p>
          {(['swissPts', 'rulesetScore'] as const).map((option) => (
            <label key={option} className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="swiss-rankby"
                className="mt-1"
                checked={draft.rankBy === option}
                disabled={locked}
                onChange={() => setDraft({ ...draft, rankBy: option })}
              />
              <span>
                <span className="font-medium text-foreground">
                  {t(`organizer.swiss.configure.rankBy.${option}`)}
                </span>
                <span className="block text-xs text-muted">
                  {t(`organizer.swiss.configure.rankBy.${option}Hint`)}
                </span>
              </span>
            </label>
          ))}

          <div className="grid grid-cols-4 gap-2 pt-2">
            {(['win', 'draw', 'loss', 'bye'] as const).map((key) => (
              <label key={key} className="block text-xs">
                <span className="font-medium text-foreground-secondary">
                  {t(`organizer.swiss.configure.points.${key}`)}
                </span>
                <input
                  type="number"
                  value={draft.points[key]}
                  disabled={locked || frozen}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      points: { ...draft.points, [key]: Number(e.target.value) },
                    })
                  }
                  className="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm disabled:opacity-60"
                />
              </label>
            ))}
          </div>
        </section>

        <TiebreakChainField
          chain={draft.tiebreakChain}
          disabled={locked}
          onChange={(tiebreakChain) => setDraft({ ...draft, tiebreakChain })}
        />
      </div>

      <aside className="sticky top-6 space-y-4 self-start rounded-lg border border-border bg-surface p-4">
        <LifecyclePanel
          view={view}
          busy={busy}
          isReadOnly={isReadOnly}
          onGenerate={() => void generate(false)}
          onRegenerate={() => setConfirmRegenerate(true)}
          onSave={() => void save()}
          onFinalise={() =>
            void run(t('organizer.swiss.configure.finalised'), () =>
              swissMutate(`/swiss-phases/${view.phaseId}/finalise`, { method: 'POST' }),
            )
          }
          onResume={() =>
            void run(t('organizer.swiss.configure.resumed'), () =>
              swissMutate(`/swiss-phases/${view.phaseId}/resume`, { method: 'POST' }),
            )
          }
        />
        {hasPhase && (
          <Link
            href={`/org/${slug}/events/${eventId}/referees#assignments`}
            className="block w-full rounded-lg border border-border bg-surface px-4 py-2 text-center text-sm font-semibold text-foreground-secondary hover:bg-background"
          >
            {t('organizer.swiss.configure.assignReferees')}
          </Link>
        )}
        <WithdrawPanel
          view={view}
          busy={busy || locked}
          onWithdraw={(registrationId) =>
            void run(t('organizer.swiss.configure.withdrawn'), () =>
              swissMutate(`/swiss-phases/${view.phaseId}/withdraw`, {
                method: 'POST',
                body: { registrationId },
              }),
            )
          }
        />
      </aside>

      <ConfirmDialog
        open={confirmRegenerate}
        title={t('organizer.swiss.configure.regenerateTitle')}
        description={t('organizer.swiss.configure.regenerateBody')}
        confirmLabel={t('organizer.swiss.configure.regenerateConfirm')}
        danger
        busy={busy}
        onCancel={() => setConfirmRegenerate(false)}
        onConfirm={() => void generate(true)}
      />
    </div>
  );
}

interface StandingsPayload {
  rows: Array<{
    registrationId: string;
    displayName: string;
    stats: Record<string, number | string>;
  }>;
}

function draftFrom(config: SwissConfig | null, recommended: number): Draft {
  return {
    roundCount: config?.roundCount ?? recommended,
    seedingStrategy: config?.seedingStrategy ?? 'random',
    sourcePhaseId: config?.sourcePhaseId ?? null,
    pairingMethod: config?.pairingMethod ?? 'fold',
    grouping: config?.grouping ?? { kind: 'points' },
    rankBy: config?.rankBy ?? 'swissPts',
    points: config?.points ?? { win: 3, draw: 1, loss: 0, bye: 3 },
    tiebreakChain: config?.tiebreakChain ?? ['buchholz', 'sonnebornBerger', 'rulesetChain'],
    minRatingCoveragePercent: config?.minRatingCoveragePercent ?? null,
  };
}
