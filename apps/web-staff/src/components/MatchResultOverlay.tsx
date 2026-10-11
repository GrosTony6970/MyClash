'use client';

/**
 * MatchResultOverlay — the end-of-bout review panel.
 *
 * Shown once the clock ends: who won, on what score, and — the reason this is a
 * panel rather than a line of text — HOW the bout got there. The flow chart and
 * the numbered timeline sit side by side and share one highlight, so scrubbing
 * the chart lights the matching row and pointing at a row lights the point.
 *
 * Its own component (rather than inline in MatchView) because it mounts only
 * when the clock ends — so the flow chart and the timeline cost nothing while
 * the bout is being fought.
 *
 * IT NO LONGER FETCHES. It used to call `useExchanges`/`usePenalties` itself,
 * which made its data current by construction: the fetch happened after the
 * clock POST returned. Reading from the lifted hook removes that guarantee, so
 * `MatchView` bumps its refresh key when a clock action lands on 'ended'. If
 * this panel ever shows the bout as of the last scored hit rather than as of
 * the final whistle, that bump is what broke.
 */

import { useState } from 'react';
import { BoutFlowChart, MatchTimeline, buildBoutFlow, buildUnifiedTimeline } from '@myclash/ui';
import type { MatchFormatConfig, TournamentScoringConfig } from '@myclash/types';
import { sideStyle } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { useScoringTheme } from '../theme/ThemeProvider';
import type { MatchScoringData } from '../hooks/useMatchScoringData';
import { resolveMatchWinner } from '@myclash/types';
import type { ClockState } from './MatchClock';
import { isDoubleLoss } from './is-double-loss';

export interface MatchResultOverlayProps {
  redName: string;
  blueName: string;
  redRegistrationId: string;
  blueRegistrationId: string;
  redScore: number;
  blueScore: number;
  /** The recorded winner. The overlay ANNOUNCES the result to the hall, so it
   *  reads the record rather than comparing the two numbers — a forfeit or a
   *  `referee_decision` override can put the winner on the lower score. */
  winnerRegistrationId: string | null;
  /**
   * A decided best-of series: its closed rounds, in order. The score above is
   * then the ROUNDS WON, and the points of each round are said in a small line
   * under it (operator, 2026-10-11). None for a bout of one round.
   */
  rounds?: ReadonlyArray<{ round: number; redScore: number; blueScore: number }>;
  /**
   * "End match" is still on the tablet: the result is the tablet's own, and
   * the screen says the server has not confirmed it (operator ruling 11).
   */
  unconfirmed?: boolean;
  /** Why the bout ended on the SERVER: the review's chart draws the server's rows. */
  endReason?: string | null;
  /**
   * Why the result above is what it is: the server's reason, or the tablet's
   * own while an End at the doubles limit is not confirmed.
   */
  resultReason: string | null;
  bestOf?: number;
  currentRound?: number;
  scoringConfig: TournamentScoringConfig;
  matchFormat: MatchFormatConfig;
  clockState: ClockState | null;
  /** The match's events, read once by `MatchView`. */
  scoring: MatchScoringData;
  nextMatchHref: string | null;
  onClose: () => void;
}

/**
 * A bout nobody won: a loss for both, or a draw.
 *
 * The two read alike on the board (0 - 0, no winner), so the reason says which
 * (`isDoubleLoss`). The reason is the server's, or the tablet's own while an
 * End at the doubles limit is not confirmed. This screen said "Draw" for both.
 */
function NoWinner({ resultReason }: Pick<MatchResultOverlayProps, 'resultReason'>) {
  const { t } = useI18n();
  if (isDoubleLoss('completed', resultReason)) {
    return (
      <p data-testid="match-result-double-loss" className="mb-2 text-3xl font-black text-danger">
        {t('scoring.liveMatch.doubleLoss')}
      </p>
    );
  }
  return (
    <p data-testid="match-result-draw" className="mb-2 text-3xl font-black text-foreground">
      {t('scoring.result.draw')}
    </p>
  );
}

/** Winner (in their own side colour), a loss for both or a draw, then the score. */
function ResultHeadline({
  redName,
  blueName,
  redScore,
  blueScore,
  redRegistrationId,
  blueRegistrationId,
  winnerRegistrationId,
  rounds,
  resultReason,
  scoringConfig,
}: Pick<
  MatchResultOverlayProps,
  | 'resultReason'
  | 'redName'
  | 'blueName'
  | 'redScore'
  | 'blueScore'
  | 'redRegistrationId'
  | 'blueRegistrationId'
  | 'winnerRegistrationId'
  | 'rounds'
  | 'scoringConfig'
>) {
  const { t } = useI18n();
  // A loss for both names nobody, whatever the board reads: a card on a wiped
  // board leaves 0 and -1, and its leader is not a winner.
  const lossForBoth = isDoubleLoss('completed', resultReason);
  const resolved = resolveMatchWinner({
    status: 'completed', // the overlay only renders once the clock has ended
    winnerRegistrationId,
    redRegistrationId,
    blueRegistrationId,
    redScore,
    blueScore,
  });
  const winner = lossForBoth ? null : resolved;
  const winnerName = winner === 'red' ? redName : winner === 'blue' ? blueName : null;

  return (
    <>
      <p className="mb-3 text-sm font-bold uppercase tracking-[0.3em] text-gold">
        {t('scoring.result.finalResult')}
      </p>
      {winnerName ? (
        <p
          // The headline is the part that ANNOUNCES a result; the bout review
          // below it deliberately names both fighters, exchange by exchange. A
          // test asking "does the overlay name only the winner" has to scope to
          // this element or it is really asking about the review.
          data-testid="match-result-winner"
          className="mb-2 flex items-center justify-center gap-2 text-3xl font-black animate-pulse"
          // The winner wears their own configured side colour, not gold.
          style={{ color: winner ? sideStyle(scoringConfig, winner).border : undefined }}
        >
          <span aria-hidden>🏆</span> {winnerName}
        </p>
      ) : (
        <NoWinner resultReason={resultReason} />
      )}
      <p
        data-testid="match-result-score"
        className={`${rounds?.length ? 'mb-1' : 'mb-4'} font-mono text-2xl font-bold text-foreground-secondary`}
      >
        {redScore} – {blueScore}
      </p>
      {rounds && rounds.length > 0 && (
        <p data-testid="match-result-rounds" className="mb-4 text-sm text-muted">
          {t('scoring.result.roundPoints')}{' '}
          <span className="font-mono">
            {rounds.map((round) => `${round.redScore} – ${round.blueScore}`).join(' · ')}
          </span>
        </p>
      )}
    </>
  );
}

/**
 * The review itself: the flow chart and the numbered timeline, sharing one
 * highlight so scrubbing either lights the other.
 *
 * Both read the rows `MatchView` already holds. This used to fetch its own on
 * mount, which made them current by construction — see the note at the top of
 * the file for what replaced that guarantee.
 */
function BoutReview({
  redName,
  blueName,
  redRegistrationId,
  blueRegistrationId,
  endReason,
  bestOf,
  currentRound,
  scoringConfig,
  matchFormat,
  clockState,
  scoring,
}: Omit<
  MatchResultOverlayProps,
  'redScore' | 'blueScore' | 'nextMatchHref' | 'onClose' | 'unconfirmed' | 'rounds'
>) {
  const { t } = useI18n();
  // The chart picks its own side colours in JS via sideColorsFor(config,
  // surface), so it needs the scope as a value — a CSS token cannot reach it.
  const { padScope } = useScoringTheme();
  const [highlight, setHighlight] = useState<number | null>(null);
  // SERVER rows only. `buildBoutFlow` charts the bout that happened; a queued
  // row is one the server has not accepted, and plotting it would draw a point
  // that may yet be refused.
  const { activeExchanges: exchanges, activePenalties: penalties } = scoring;

  const events = buildUnifiedTimeline({
    exchanges,
    penalties,
    redName,
    blueName,
    redRegId: redRegistrationId,
    blueRegId: blueRegistrationId,
    t,
    config: scoringConfig,
  });

  const flow = buildBoutFlow({
    exchanges,
    penalties,
    redRegId: redRegistrationId,
    blueRegId: blueRegistrationId,
    matchFormat,
    endReason,
    bestOf,
    currentRound,
    clockEvents: clockState?.events,
  });

  return (
    // Single column below md — the pad is landscape, but a phone-sized
    // viewport must still read.
    <div className="mb-5 grid gap-3 text-left md:grid-cols-2">
      <BoutFlowChart
        series={flow}
        config={scoringConfig}
        redName={redName}
        blueName={blueName}
        surface={padScope}
        scale="compact"
        highlightNumber={highlight}
        onHighlightChange={setHighlight}
        t={t}
      />
      <MatchTimeline
        events={events}
        scale="compact"
        ariaLabel={t('scoring.lice.eventsHeader')}
        highlightNumber={highlight}
        onHighlightChange={setHighlight}
        t={t}
      />
    </div>
  );
}

/** "End match" is still on the tablet: the server has not confirmed this result. */
function NotConfirmed() {
  const { t } = useI18n();
  return (
    <p
      role="status"
      data-testid="match-result-unconfirmed"
      className="mb-4 rounded-lg bg-warning/15 px-3 py-2 text-sm font-bold text-warning"
    >
      {t('scoring.result.notConfirmed')}
    </p>
  );
}

export function MatchResultOverlay(props: MatchResultOverlayProps) {
  const { t } = useI18n();
  const { redName, blueName, redScore, blueScore, scoringConfig, nextMatchHref, onClose } = props;

  return (
    <div
      data-testid="match-result-overlay"
      className="fixed inset-0 z-overlay flex items-center justify-center bg-black/70 p-4"
    >
      <div className="w-full max-w-3xl rounded-xl border border-gold/60 bg-surface p-6 text-center shadow-2xl">
        <ResultHeadline
          redName={redName}
          blueName={blueName}
          redScore={redScore}
          blueScore={blueScore}
          redRegistrationId={props.redRegistrationId}
          blueRegistrationId={props.blueRegistrationId}
          winnerRegistrationId={props.winnerRegistrationId}
          rounds={props.rounds}
          resultReason={props.resultReason}
          scoringConfig={scoringConfig}
        />
        {props.unconfirmed && <NotConfirmed />}
        <BoutReview {...props} />

        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border-2 border-border bg-surface px-6 py-2 text-sm font-bold text-foreground-secondary hover:bg-border"
          >
            {t('scoring.result.close')}
          </button>
          {nextMatchHref && (
            <a
              href={nextMatchHref}
              className="rounded-lg border-2 border-success bg-success px-6 py-2 text-sm font-bold text-success-foreground hover:bg-success-hover"
            >
              {t('scoring.lice.nextMatchLabel')} →
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
