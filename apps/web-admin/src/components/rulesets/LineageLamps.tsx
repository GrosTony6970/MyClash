'use client';

import type { BucketDiff, BucketStatus } from '@myclash/rulesets';
import { useI18n } from '../../i18n/I18nProvider';

/** One computed lineage lamp: a coloured dot (green unchanged / amber changed),
 *  a bucket label, and its status word. Never self-declared — the `changed`
 *  flag always comes from a diffed {@link BucketDiff}. */
function LineageLamp({
  changed,
  label,
  statusLabel,
}: {
  changed: boolean;
  label: string;
  statusLabel: string;
}) {
  return (
    <li className="flex items-center gap-2 text-sm">
      <span
        aria-hidden="true"
        className={`h-2 w-2 shrink-0 rounded-full ${changed ? 'bg-warning' : 'bg-success'}`}
      />
      <span className="text-foreground-secondary">{label}</span>
      <span className={`text-xs ${changed ? 'text-warning' : 'text-muted'}`}>· {statusLabel}</span>
    </li>
  );
}

/**
 * The per-bucket lineage lamps (grammar · end conditions · ranking) + the
 * ranking-compatibility guardrail, computed by diffing a ruleset against the
 * base it reuses — never self-declared. Shared by the fork authoring panel and
 * the mid-event re-pin ceremony so both read the identical signal.
 */
export function LineageLamps({ base, diff }: { base: string; diff: BucketDiff }) {
  const { t } = useI18n();
  const status = (s: BucketStatus) =>
    s === 'changed' ? t('admin.rulesets.lineageCustomised') : t('admin.rulesets.lineageSame');
  return (
    <div>
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
        {t('admin.rulesets.lineageHeading', { base })}
      </p>
      <ul className="space-y-1">
        <LineageLamp
          changed={diff.grammar === 'changed'}
          label={t('admin.rulesets.lineageGrammar')}
          statusLabel={status(diff.grammar)}
        />
        <LineageLamp
          changed={diff.endConditions === 'changed'}
          label={t('admin.rulesets.lineageEndConditions')}
          statusLabel={status(diff.endConditions)}
        />
        <LineageLamp
          changed={diff.ranking === 'changed'}
          label={t('admin.rulesets.lineageRanking')}
          statusLabel={status(diff.ranking)}
        />
      </ul>
      {!diff.rankingCompatible && (
        <p className="mt-3 rounded bg-warning/10 px-3 py-2 text-xs text-warning">
          {t('admin.rulesets.lineageRankingWarning', { base })}
        </p>
      )}
    </div>
  );
}

/**
 * The single computed penalty lineage lamp for the penalty authoring surface:
 * how a custom penalty ruleset diverges from the built-in default it is compared
 * against (never self-declared). A `changed` status always breaks scoring
 * compatibility — every field the penalty canonical keeps re-ranks results — so
 * it always shows the guardrail.
 */
export function PenaltyLineagePanel({ base, status }: { base: string; status: BucketStatus }) {
  const { t } = useI18n();
  const changed = status === 'changed';
  return (
    <div className="mb-4 rounded-md border border-border bg-surface p-4">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
        {t('admin.rulesets.lineageHeading', { base })}
      </p>
      <ul className="space-y-1">
        <LineageLamp
          changed={changed}
          label={t('admin.penaltyRulesets.lineagePenalties')}
          statusLabel={
            changed ? t('admin.rulesets.lineageCustomised') : t('admin.rulesets.lineageSame')
          }
        />
      </ul>
      {changed && (
        <p className="mt-3 rounded bg-warning/10 px-3 py-2 text-xs text-warning">
          {t('admin.penaltyRulesets.lineagePenaltyWarning', { base })}
        </p>
      )}
    </div>
  );
}

/**
 * Read-only view of a coded fork on the authoring surface: what it is, and —
 * computed by diffing, never self-declared — which of the buckets diverge from
 * the base it reuses.
 */
export function ForkLineagePanel({ base, diff }: { base: string; diff: BucketDiff | null }) {
  const { t } = useI18n();
  return (
    <div className="rounded-md border border-border bg-surface p-6">
      <h2 className="font-display font-semibold text-lg text-foreground">
        {t('admin.rulesets.forkPanelTitle')}
      </h2>
      <p className="mt-2 text-sm text-foreground-secondary">
        {t('admin.rulesets.forkPanelBody', { base })}
      </p>
      {diff && (
        <div className="mt-4">
          <LineageLamps base={base} diff={diff} />
        </div>
      )}
    </div>
  );
}
