'use client';

/**
 * The Format block of the Configure tab: rounds, round-1 draw, pairing method.
 *
 * Split out purely for size — ConfigureTab crossed the 400-line file limit once
 * prettier reflowed it. The seeding fields are the interesting part: the
 * strategy is fixed once the phase exists (redrawing is `regenerate`, not an
 * edit), and `pairingMethod` freezes from round 2 because changing it would
 * rewrite what the rounds already played were worth.
 */

import { t } from '@myclash/i18n';
import { HelpTooltip } from '@myclash/ui';
import type { UseSwissAdmin } from '../useSwissAdmin';
import type { Draft } from '../_tabs/ConfigureTab';

const SEEDING = ['random', 'by-rating', 'by-pool-rank'] as const;
const PAIRING = ['fold', 'adjacent'] as const;

export function FormatSection({
  draft,
  view,
  hasPhase,
  locked,
  frozen,
  frozenReason,
  onChange,
}: {
  draft: Draft;
  view: NonNullable<UseSwissAdmin['view']>;
  hasPhase: boolean;
  locked: boolean;
  frozen: boolean;
  frozenReason: string | null;
  onChange: (next: Draft) => void;
}) {
  return (
    <section className="space-y-3 rounded-lg border border-border bg-surface p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
        {t('organizer.swiss.configure.formatTitle')}
      </h2>

      <label className="block text-sm">
        <span className="flex items-center font-medium text-foreground-secondary">
          {t('organizer.swiss.configure.roundCount')}
          <HelpTooltip text={t('organizer.swiss.configure.roundCountHelp')} />
        </span>
        <input
          type="number"
          min={3}
          max={9}
          value={draft.roundCount}
          disabled={locked}
          onChange={(e) => onChange({ ...draft, roundCount: Number(e.target.value) })}
          className="mt-1 w-28 rounded-md border border-border px-3 py-2 text-sm"
        />
        <span className="ml-2 text-xs text-muted">
          {t('organizer.swiss.configure.recommended', {
            count: view.recommendedRoundCount,
            fighters: hasPhase ? view.entrants.length : view.registeredCount,
          })}
        </span>
      </label>

      <label className="block text-sm">
        <span className="font-medium text-foreground-secondary">
          {t('organizer.swiss.configure.seeding')}
        </span>
        <select
          value={draft.seedingStrategy}
          disabled={locked || hasPhase}
          onChange={(e) =>
            onChange({ ...draft, seedingStrategy: e.target.value as Draft['seedingStrategy'] })
          }
          className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm disabled:opacity-60"
        >
          {SEEDING.map((strategy) => (
            <option key={strategy} value={strategy}>
              {t(`organizer.swiss.configure.seedingOption.${strategy}`)}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-xs text-muted">
          {hasPhase
            ? t('organizer.swiss.configure.seedingLocked')
            : t(`organizer.swiss.configure.seedingHint.${draft.seedingStrategy}`)}
        </span>
        <CoverageLine
          coverage={view.ratingCoverage}
          threshold={draft.minRatingCoveragePercent}
          highlight={draft.seedingStrategy === 'by-rating'}
        />
      </label>

      {draft.seedingStrategy === 'by-rating' && !hasPhase && (
        <label className="block text-sm">
          <span className="flex items-center font-medium text-foreground-secondary">
            {t('organizer.swiss.configure.minCoverage')}
            <HelpTooltip text={t('organizer.swiss.configure.minCoverageHelp')} />
          </span>
          <input
            type="number"
            min={0}
            max={100}
            value={draft.minRatingCoveragePercent ?? 0}
            onChange={(e) =>
              onChange({ ...draft, minRatingCoveragePercent: Number(e.target.value) })
            }
            className="mt-1 w-28 rounded-md border border-border px-3 py-2 text-sm"
          />
        </label>
      )}

      <label className="block text-sm">
        <span className="font-medium text-foreground-secondary">
          {t('organizer.swiss.configure.pairingMethod')}
        </span>
        <select
          value={draft.pairingMethod}
          disabled={locked || frozen}
          onChange={(e) =>
            onChange({ ...draft, pairingMethod: e.target.value as Draft['pairingMethod'] })
          }
          className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm disabled:opacity-60"
        >
          {PAIRING.map((method) => (
            <option key={method} value={method}>
              {t(`organizer.swiss.configure.pairingOption.${method}`)}
            </option>
          ))}
        </select>
        {frozenReason && <span className="mt-1 block text-xs text-warning">{frozenReason}</span>}
      </label>
    </section>
  );
}

/**
 * How much of the field HEMA Ratings knows about.
 *
 * Shown whatever the strategy, because it is what makes `by-rating` a real
 * choice rather than a guess — and it is shown BEFORE generating, since the
 * seeder's only other way of telling the operator is a 400 on submit.
 *
 * Below the configured threshold it says so outright: that combination is
 * already refused server-side, and finding out at submit time is the failure
 * this line exists to prevent.
 */
function CoverageLine({
  coverage,
  threshold,
  highlight,
}: {
  coverage: { rated: number; total: number; percent: number } | null;
  threshold: number | null;
  highlight: boolean;
}) {
  // Null means the ratings lookup itself failed; saying nothing beats claiming
  // 0% and pushing the operator away from a strategy that may be fine.
  if (!coverage || coverage.total === 0) return null;
  const belowThreshold = threshold !== null && coverage.percent < threshold;
  return (
    <span
      className={[
        'mt-1 block text-xs',
        belowThreshold && highlight ? 'text-warning' : 'text-muted',
      ].join(' ')}
    >
      {t('organizer.swiss.configure.ratingCoverage', {
        rated: coverage.rated,
        total: coverage.total,
        percent: coverage.percent,
      })}
      {belowThreshold && highlight && (
        <> {t('organizer.swiss.configure.ratingCoverageBelow', { threshold })}</>
      )}
    </span>
  );
}
