'use client';

import { useI18n } from '@/i18n/I18nProvider';
import type { PersonContext } from './personContext';

function Field({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="text-muted">{label}:</span>
      <span className="font-medium text-foreground">{value}</span>
    </span>
  );
}

function formatWhen(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

/**
 * The live tournament-context block on a People-hub fighter card: tournament,
 * pool, license, rank, and next match. Shared by the Search and Following tabs.
 * Renders a muted "not competing" line (still showing the license) when the
 * fighter has no active tournament.
 */
export function PersonContextDetails({
  ctx,
  loading = false,
}: {
  ctx?: PersonContext;
  loading?: boolean;
}) {
  const { t } = useI18n();

  if (!ctx) {
    if (loading) {
      return (
        <div className="mt-3 border-t border-border pt-3">
          <div className="h-3 w-40 animate-pulse rounded bg-foreground/10" />
        </div>
      );
    }
    return null;
  }

  const nextWhen = ctx.nextMatch ? formatWhen(ctx.nextMatch.scheduledAt) : null;

  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
      {ctx.tournament ? (
        <>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <Field label={t('publicApp.me.people.ctxTournament')} value={ctx.tournament.name} />
            {ctx.poolName && (
              <Field label={t('publicApp.me.people.ctxPool')} value={ctx.poolName} />
            )}
            {ctx.rank !== null && (
              <Field label={t('publicApp.me.people.ctxRank')} value={`#${ctx.rank}`} />
            )}
            {ctx.license && (
              <Field label={t('publicApp.me.people.ctxLicense')} value={ctx.license} />
            )}
          </div>
          {ctx.nextMatch ? (
            <p className="text-xs text-accent">
              <span className="font-semibold">{t('publicApp.me.people.ctxNextMatch')}:</span>{' '}
              {[
                ctx.nextMatch.label,
                ctx.nextMatch.opponentName
                  ? t('publicApp.me.people.ctxVs', { name: ctx.nextMatch.opponentName })
                  : null,
                nextWhen,
                ctx.nextMatch.liceName,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          ) : (
            <p className="text-xs text-muted">{t('publicApp.me.people.ctxNoMatch')}</p>
          )}
        </>
      ) : (
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
          {ctx.license && <Field label={t('publicApp.me.people.ctxLicense')} value={ctx.license} />}
          <span className="text-muted">{t('publicApp.me.people.notCompeting')}</span>
        </div>
      )}
    </div>
  );
}
