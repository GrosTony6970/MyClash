'use client';

import Link from 'next/link';
import { sideStyle } from '@myclash/ui';
import { useI18n } from '../../../../src/i18n/I18nProvider';
import type { LiceMatch } from '../../../../src/components/lice-match-types';
import { isLiveStatus } from '../../../../src/components/partition-lice-matches';
import { MatchStatusPill } from './MatchStatusPill';

/**
 * A fighter line with the organiser's corner colour.
 *
 * The colour comes from `sideStyle` and nowhere else — on this surface the
 * corners ARE the record of the bout, so a hardcoded red/blue would misreport
 * a result for any organiser who configured their own.
 */
function FighterLine({
  name,
  color,
  compact,
}: {
  name: string | null;
  color: string;
  compact: boolean;
}) {
  return (
    <p className={`font-semibold leading-tight ${compact ? 'text-sm' : 'text-base'}`}>
      <span style={{ color }} aria-hidden>
        ●{' '}
      </span>
      {name ?? '—'}
    </p>
  );
}

/** Referees officiating this bout. Absent when nobody is assigned. */
function RefereeLine({ names }: { names: string[] }) {
  const { t } = useI18n();
  if (names.length === 0) return null;
  return (
    <p className="mt-1 truncate text-xs text-muted">
      <span aria-hidden>⚖ </span>
      <span className="sr-only">{t('scoring.lice.refereeLabel')}: </span>
      {names.join(', ')}
    </p>
  );
}

/**
 * One bout on the piste, as a tappable row.
 *
 * `compact` is the "all matches" variant — same information, tighter type, so a
 * 60-bout day stays scannable. It never goes below the 44px touch minimum.
 */
export function LiceMatchCard({ match, compact = false }: { match: LiceMatch; compact?: boolean }) {
  const redColor = sideStyle(match.scoringConfig, 'red').border;
  const blueColor = sideStyle(match.scoringConfig, 'blue').border;
  const live = isLiveStatus(match.status);
  const time = match.scheduledAt
    ? new Date(match.scheduledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;
  // 0-0 on a bout that has not started is noise, not information.
  const showScore = match.status !== 'scheduled';

  return (
    <Link
      href={`/matches/${match.id}`}
      className={`block min-h-[44px] rounded-xl border px-4 ${
        compact ? 'py-2' : 'py-3'
      } transition-colors hover:border-muted hover:bg-background ${
        live ? 'border-accent bg-accent/10' : 'border-border bg-surface'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-xs font-bold uppercase tracking-widest text-muted">
            {match.roundCode ?? match.matchNumberLabel ?? '—'}
          </p>
          <div className="mt-1">
            <FighterLine name={match.redFighterName} color={redColor} compact={compact} />
            <FighterLine name={match.blueFighterName} color={blueColor} compact={compact} />
          </div>
          <RefereeLine names={match.refereeNames} />
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {showScore && (
            <p className="font-mono text-lg font-bold leading-none tabular-nums">
              <span style={{ color: redColor }}>{match.redScore}</span>
              <span className="text-muted">–</span>
              <span style={{ color: blueColor }}>{match.blueScore}</span>
            </p>
          )}
          {time && <p className="font-mono text-sm tabular-nums text-muted">{time}</p>}
          <MatchStatusPill status={match.status} />
        </div>
      </div>
    </Link>
  );
}
