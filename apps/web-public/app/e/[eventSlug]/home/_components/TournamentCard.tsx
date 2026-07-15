import Link from 'next/link';
import { t as tr } from '@myclash/i18n';
import { formatInZone } from '@myclash/time';
import { StatusBadge, accentClassFor, tournamentStatusSemantic } from '@myclash/ui';
import { type Tournament } from '../_lib/public-event-data';

/**
 * One tournament card — shared by the event home and the /tournaments full list.
 * Shows the first-pool start date+time when scheduled.
 */
export function TournamentCard({
  tournament: t,
  eventSlug,
  tz,
  className,
}: {
  tournament: Tournament;
  eventSlug: string;
  tz: string;
  className?: string;
}) {
  return (
    <Link
      href={`/e/${eventSlug}/t/${encodeURIComponent(t.slug)}`}
      className={`group relative flex min-h-36 flex-col justify-between overflow-hidden rounded-xl border border-border bg-surface p-4 pl-5 shadow-sm transition-colors hover:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40${className ? ` ${className}` : ''}`}
    >
      <span
        aria-hidden="true"
        className={`absolute left-0 top-0 h-full w-1 ${accentClassFor(t.color)}`}
      />
      <div>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-base font-semibold text-foreground">
              {t.name}
            </p>
            {t.ruleset_code && (
              <p className="mt-0.5 font-mono text-xs text-muted">{t.ruleset_code}</p>
            )}
          </div>
          {t.status && (
            <StatusBadge semantic={tournamentStatusSemantic(t.status)} surface="light">
              {t.status}
            </StatusBadge>
          )}
        </div>
        {t.scheduledStart && (
          <p className="mt-1.5 text-xs text-muted">
            <span className="font-medium text-foreground-secondary">
              {tr('publicApp.eventHome.tournament.firstPool')}:
            </span>{' '}
            {formatInZone(t.scheduledStart, tz, {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
        )}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <div className="space-y-0.5">
          {t.registered > 0 && (
            <p className="text-foreground-secondary">
              <span className="font-semibold tabular-nums">{t.registered}</span>{' '}
              <span className="text-muted">{tr('publicApp.eventHome.card.fighters')}</span>
            </p>
          )}
          {t.refereeCount > 0 && (
            <p className="text-foreground-secondary">
              <span className="font-semibold tabular-nums">{t.refereeCount}</span>{' '}
              <span className="text-muted">{tr('publicApp.eventHome.card.referees')}</span>
            </p>
          )}
        </div>
        <div className="space-y-0.5 text-right">
          {t.poolCount > 0 && (
            <p className="text-foreground-secondary">
              <span className="font-semibold tabular-nums">{t.poolCount}</span>{' '}
              <span className="text-muted">{tr('publicApp.eventHome.card.pools')}</span>
            </p>
          )}
          {t.bracketSize > 0 && (
            <p className="text-foreground-secondary">
              <span className="text-muted">{tr('publicApp.eventHome.card.bracket')} </span>
              <span className="font-semibold tabular-nums">{t.bracketSize}</span>
            </p>
          )}
        </div>
      </div>
      {(t.poolFightsTotal > 0 || t.bracketFightsTotal > 0) && (
        <div className="mt-1 space-y-0.5 text-right text-xs text-muted">
          {t.poolFightsTotal > 0 && (
            <p className="whitespace-nowrap">
              {tr('publicApp.eventHome.card.completedPoolFights', {
                completed: t.poolFightsCompleted,
                total: t.poolFightsTotal,
              })}
            </p>
          )}
          {t.bracketFightsTotal > 0 && (
            <p className="whitespace-nowrap">
              {tr('publicApp.eventHome.card.completedBracketFights', {
                completed: t.bracketFightsCompleted,
                total: t.bracketFightsTotal,
              })}
            </p>
          )}
        </div>
      )}
      <div className="mt-2 flex justify-end text-xs">
        <span className="font-semibold text-accent group-hover:text-accent-hover">→</span>
      </div>
    </Link>
  );
}
