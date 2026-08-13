'use client';

import type * as React from 'react';
import { useRouter } from 'next/navigation';
import { sideColorsFor } from '@myclash/ui';
import { resolveMatchWinner, type TournamentScoringConfig } from '@myclash/types';
import { useI18n } from '@myclash/next-i18n/client';
import { useScoringTheme } from '../../../../src/theme/ThemeProvider';
import type { PoolMatchRow } from '../../../../src/components/tournament-context-types';
import { MatchStatusPill } from './MatchStatusPill';

/** The RECORDED winner, never the higher score — a forfeit or a
 *  `referee_decision` override can award the bout to the fighter behind on
 *  points, and this list is the piste operator's copy of the organiser's
 *  Matches tab, so the two have to agree. */
function winnerSide(match: PoolMatchRow): 'red' | 'blue' | null {
  return resolveMatchWinner({
    status: match.status,
    winnerRegistrationId: match.winner_registration_id,
    redRegistrationId: match.red_registration_id,
    blueRegistrationId: match.blue_registration_id,
    redScore: match.red_score,
    blueScore: match.blue_score,
  });
}

/** Name + the organiser's corner colour + the club, as one cell. */
function FighterCell({
  name,
  club,
  color,
  isWinner,
}: {
  name: string;
  club: string | null;
  color: string;
  isWinner: boolean;
}) {
  return (
    // `whitespace-nowrap`, and the table below carries a min-width: the grid
    // lives in a max-w-3xl column, so a `w-full` table would compress the
    // columns to fit instead of letting the scroller do its job — which put the
    // club badge on top of the Lice column and broke names across two lines.
    <td className="whitespace-nowrap px-3 py-2">
      <span className="flex items-center gap-2">
        <span
          className="h-6 w-1 shrink-0 rounded"
          style={{ backgroundColor: color }}
          aria-hidden="true"
        />
        <span className={isWinner ? 'font-bold text-foreground' : 'font-medium'}>
          {name || '—'}
        </span>
        {club && (
          <span className="shrink-0 rounded bg-border px-1.5 py-0.5 text-xs text-foreground-secondary">
            {club}
          </span>
        )}
      </span>
    </td>
  );
}

/** One side's score. A dash — not a 0 — until the bout has actually been played. */
function ScoreCell({
  score,
  played,
  isWinner,
}: {
  score: number | null;
  played: boolean;
  isWinner: boolean;
}) {
  return (
    <td
      className={`whitespace-nowrap px-2 py-2 text-center font-mono tabular-nums ${
        isWinner ? 'font-bold text-foreground' : 'text-foreground-secondary'
      }`}
    >
      {played ? (score ?? 0) : <span className="text-muted">-</span>}
    </td>
  );
}

function HeaderRow() {
  const { t } = useI18n();
  const cell = 'whitespace-nowrap px-3 py-2 font-semibold';
  return (
    <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted">
      <th scope="col" className={cell}>
        {t('scoring.lice.poolTable.round')}
      </th>
      <th scope="col" className={cell}>
        {t('scoring.lice.red')}
      </th>
      <th scope="col" className="whitespace-nowrap px-2 py-2 text-center font-semibold">
        {t('scoring.lice.poolTable.scoreRed')}
      </th>
      <th scope="col" className="whitespace-nowrap px-2 py-2 text-center font-semibold">
        {t('scoring.lice.poolTable.scoreBlue')}
      </th>
      <th scope="col" className={cell}>
        {t('scoring.lice.blue')}
      </th>
      <th scope="col" className={cell}>
        {t('scoring.lice.poolTable.lice')}
      </th>
      <th scope="col" className={cell}>
        {t('scoring.lice.poolTable.status')}
      </th>
    </tr>
  );
}

/** Make a `<tr>` behave as a link — pointer, keyboard and role together. */
function activationProps(open: (() => void) | undefined) {
  if (!open) return {};
  return {
    role: 'link' as const,
    tabIndex: 0,
    onClick: open,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    },
  };
}

/**
 * One bout.
 *
 * Rows on another lice are NOT links: they are not this operator's to score,
 * and a tap that opens someone else's pad mid-event is how a bout gets
 * recorded twice.
 */
function MatchRow({
  match,
  mine,
  sideColors,
}: {
  match: PoolMatchRow;
  mine: boolean;
  sideColors: { red: string; blue: string };
}) {
  const router = useRouter();
  const winner = winnerSide(match);
  const played = match.status === 'completed';
  const open = mine ? () => router.push(`/matches/${match.id}`) : undefined;

  return (
    <tr
      {...activationProps(open)}
      className={[
        'border-b border-border last:border-0 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-accent',
        open ? 'cursor-pointer hover:bg-surface' : '',
        // Completed rows recede; ours stays lit whatever its status.
        mine ? 'bg-accent/10' : played ? 'bg-background text-foreground-secondary' : 'bg-surface',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-muted">
        {match.roundCode || match.match_number_label || '—'}
      </td>
      <FighterCell
        name={match.red_name}
        club={match.red_club_abbrev}
        color={sideColors.red}
        isWinner={winner === 'red'}
      />
      <ScoreCell score={match.red_score} played={played} isWinner={winner === 'red'} />
      <ScoreCell score={match.blue_score} played={played} isWinner={winner === 'blue'} />
      <FighterCell
        name={match.blue_name}
        club={match.blue_club_abbrev}
        color={sideColors.blue}
        isWinner={winner === 'blue'}
      />
      <td className="whitespace-nowrap px-3 py-2 text-xs text-muted">{match.lice_name ?? '—'}</td>
      <td className="whitespace-nowrap px-3 py-2">
        <MatchStatusPill status={match.status} />
      </td>
    </tr>
  );
}

/**
 * A pool's full match grid, in the same shape the organiser reads on the admin
 * Matches tab: round code, both corners with their club and configured colour,
 * the score with the winner in bold, the piste, the status.
 *
 * The thin list this replaced dropped the club, the colours and the winner, so
 * the operator could not read a played bout's result at all — which is half of
 * what they open a pool for.
 */
export function PoolMatchList({
  matches,
  liceId,
  scoringConfig,
}: {
  matches: PoolMatchRow[];
  liceId: string;
  scoringConfig: TournamentScoringConfig | null;
}) {
  const { chromeScope } = useScoringTheme();
  if (matches.length === 0) return null;

  // Clamped for the surface these rows paint on — `sideStyle` raw would render
  // a white-configured corner invisible on the light chrome.
  const sideColors = sideColorsFor(scoringConfig, chromeScope);

  return (
    // The overflow container owns the horizontal scrollport: the pool card sits
    // inside the page scroller, so the table must never widen the body.
    <div className="mt-2 overflow-x-auto">
      <table className="w-full min-w-[52rem] text-sm">
        <thead>
          <HeaderRow />
        </thead>
        <tbody>
          {matches.map((match) => (
            <MatchRow
              key={match.id}
              match={match}
              mine={match.lice_id === liceId}
              sideColors={sideColors}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
