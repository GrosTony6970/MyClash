'use client';

import Link from 'next/link';
import { sideStyle } from '@myclash/ui';
import type { LiceMatch } from '../../../../src/components/lice-match-types';
import { isLiveStatus } from '../../../../src/components/partition-lice-matches';
import { CornerDot } from '../../../../src/components/CornerDot';
import { MatchStatusPill } from './MatchStatusPill';
import { RefereeChipLine } from './RefereeChipLine';

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
    <p
      className={`flex items-center gap-1.5 font-semibold leading-tight ${compact ? 'text-sm' : 'text-base'}`}
    >
      <CornerDot hex={color} />
      {name ?? '—'}
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
        live ? 'border-gold-text bg-accent/10' : 'border-border bg-surface'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-xs font-bold uppercase tracking-widest text-foreground-secondary">
            {match.roundCode ?? match.matchNumberLabel ?? '—'}
          </p>
          <div className="mt-1">
            <FighterLine name={match.redFighterName} color={redColor} compact={compact} />
            <FighterLine name={match.blueFighterName} color={blueColor} compact={compact} />
          </div>
          <RefereeChipLine referees={match.referees ?? []} />
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {showScore && (
            <p className="flex items-center gap-1 font-mono text-lg font-bold leading-none tabular-nums text-foreground">
              <CornerDot hex={redColor} />
              {match.redScore}
              <span className="text-muted">–</span>
              {match.blueScore}
              <CornerDot hex={blueColor} />
            </p>
          )}
          {time && (
            <p className="font-mono text-sm tabular-nums text-foreground-secondary">{time}</p>
          )}
          <MatchStatusPill status={match.status} />
        </div>
      </div>
    </Link>
  );
}
