'use client';

/**
 * The right rail of the Configure tab: what you can DO to the phase, and who is
 * in it.
 *
 * Split out of ConfigureTab, which was 529 lines — the form and the lifecycle
 * are two separate jobs that happen to share a screen, and only one of them
 * needs the draft state.
 */

import { t } from '@myclash/i18n';
import type { UseSwissAdmin } from '../useSwissAdmin';

type SwissView = NonNullable<UseSwissAdmin['view']>;

export function LifecyclePanel({
  view,
  busy,
  isReadOnly,
  onGenerate,
  onRegenerate,
  onSave,
  onFinalise,
  onResume,
}: {
  view: SwissView;
  busy: boolean;
  isReadOnly: boolean;
  onGenerate: () => void;
  onRegenerate: () => void;
  onSave: () => void;
  onFinalise: () => void;
  onResume: () => void;
}) {
  const hasPhase = view.phaseId !== null;
  const finalized = Boolean(view.config?.finalized);
  return (
    <div className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
        {t('organizer.swiss.configure.lifecycleTitle')}
      </h2>
      {!hasPhase && (
        <button
          type="button"
          disabled={busy || isReadOnly || view.registeredCount < 2}
          onClick={onGenerate}
          className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground hover:bg-accent-hover disabled:opacity-50"
        >
          {t('organizer.swiss.configure.generate')}
        </button>
      )}
      {hasPhase && (
        <>
          <button
            type="button"
            disabled={busy || isReadOnly || finalized}
            onClick={onSave}
            className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground hover:bg-accent-hover disabled:opacity-50"
          >
            {t('organizer.swiss.configure.save')}
          </button>
          {finalized ? (
            <button
              type="button"
              disabled={busy || isReadOnly}
              onClick={onResume}
              className="w-full rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground-secondary hover:bg-background disabled:opacity-50"
            >
              {t('organizer.swiss.configure.resume')}
            </button>
          ) : (
            <button
              type="button"
              disabled={busy || isReadOnly}
              onClick={onFinalise}
              className="w-full rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground-secondary hover:bg-background disabled:opacity-50"
            >
              {t('organizer.swiss.configure.finalise')}
            </button>
          )}
          <button
            type="button"
            disabled={busy || isReadOnly || finalized}
            onClick={onRegenerate}
            className="w-full rounded-lg border border-danger/30 bg-danger/10 px-4 py-2 text-sm font-semibold text-danger hover:bg-danger/20 disabled:opacity-50"
          >
            {t('organizer.swiss.configure.regenerate')}
          </button>
        </>
      )}
      {finalized && view.config?.finalized && (
        <p className="text-xs text-muted">
          {t('organizer.swiss.configure.finalisedAt', {
            round: view.config.finalized.atRound,
            total: view.config.roundCount,
          })}
        </p>
      )}
    </div>
  );
}

export function WithdrawPanel({
  view,
  busy,
  onWithdraw,
}: {
  view: SwissView;
  busy: boolean;
  onWithdraw: (registrationId: string) => void;
}) {
  if (view.entrants.length === 0) return null;
  return (
    <div className="space-y-2 border-t border-border pt-4">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
        {t('organizer.swiss.configure.entrantsTitle', { count: view.entrants.length })}
      </h2>
      <p className="text-xs text-muted">{t('organizer.swiss.configure.withdrawHint')}</p>
      <ul className="max-h-[40vh] space-y-1 overflow-y-auto">
        {view.entrants.map((entrant) => (
          <li
            key={entrant.registrationId}
            className="flex items-center justify-between gap-2 rounded border border-border bg-background px-2 py-1 text-xs"
          >
            <span className="min-w-0 truncate">
              <span className="font-medium text-foreground">{entrant.personName}</span>
              {entrant.clubLabel && <span className="ml-1 text-muted">{entrant.clubLabel}</span>}
            </span>
            {entrant.withdrawnAtRound !== null ? (
              <span className="shrink-0 rounded-full bg-warning/15 px-2 py-0.5 font-semibold text-warning">
                {t('organizer.swiss.configure.withdrawnAt', { round: entrant.withdrawnAtRound })}
              </span>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => onWithdraw(entrant.registrationId)}
                className="shrink-0 rounded border border-border px-2 py-0.5 text-muted hover:border-danger hover:text-danger disabled:opacity-40"
              >
                {t('organizer.swiss.configure.withdraw')}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
