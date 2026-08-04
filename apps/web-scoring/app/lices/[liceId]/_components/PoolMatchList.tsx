'use client';

import Link from 'next/link';
import type { PoolMatchRow } from '../../../../src/components/tournament-context-types';
import { MatchStatusPill } from './MatchStatusPill';

/**
 * A pool's full match grid, with this piste's bouts ringed.
 *
 * Matches on another lice render as plain rows, not links: they are not this
 * operator's to score, and a tap that opens someone else's pad mid-event is
 * how a bout gets recorded twice.
 */
export function PoolMatchList({ matches, liceId }: { matches: PoolMatchRow[]; liceId: string }) {
  if (matches.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-col gap-1">
      {matches.map((match) => {
        const mine = match.lice_id === liceId;
        const played = match.status === 'completed';
        const body = (
          <div className="flex min-h-[44px] items-center gap-2 px-2 py-1.5">
            <span className="w-24 shrink-0 truncate font-mono text-[10px] uppercase tracking-wider text-muted">
              {match.roundCode || match.match_number_label || '—'}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm">
              {match.red_name} <span className="text-muted">/</span> {match.blue_name}
            </span>
            {played && (
              <span className="shrink-0 font-mono text-sm font-bold tabular-nums">
                {match.red_score ?? 0}–{match.blue_score ?? 0}
              </span>
            )}
            <MatchStatusPill status={match.status} />
          </div>
        );
        const className = `rounded-lg border ${
          mine ? 'border-accent bg-accent/10' : 'border-border bg-background'
        }`;
        return (
          <li key={match.id} className={className}>
            {mine ? (
              <Link href={`/matches/${match.id}`} className="block hover:bg-surface">
                {body}
              </Link>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ul>
  );
}
