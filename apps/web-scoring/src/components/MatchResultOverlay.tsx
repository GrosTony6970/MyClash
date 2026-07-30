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
 * when the clock ends: `useExchanges`/`usePenalties` then fetch once, at the
 * moment the bout finishes, instead of adding another live poll to a pad that
 * already runs two.
 */

import { useState } from 'react';
import { BoutFlowChart, MatchTimeline, buildBoutFlow, buildUnifiedTimeline } from '@myclash/ui';
import type { MatchFormatConfig, TournamentScoringConfig } from '@myclash/types';
import { sideStyle } from '@myclash/ui';
import { useI18n } from '../i18n/I18nProvider';
import { useExchanges } from '../hooks/useExchanges';
import { usePenalties } from '../hooks/usePenalties';
import { matchWinnerSide } from './match-winner';
import type { ClockState } from './MatchClock';

export interface MatchResultOverlayProps {
  apiUrl: string;
  matchId: string;
  redName: string;
  blueName: string;
  redRegistrationId: string;
  blueRegistrationId: string;
  redScore: number;
  blueScore: number;
  endReason?: string | null;
  bestOf?: number;
  currentRound?: number;
  scoringConfig: TournamentScoringConfig;
  matchFormat: MatchFormatConfig;
  clockState: ClockState | null;
  refreshKey: number;
  nextMatchHref: string | null;
  onClose: () => void;
}

/** Winner (in their own side colour) or draw, then the score. */
function ResultHeadline({
  redName,
  blueName,
  redScore,
  blueScore,
  scoringConfig,
}: Pick<
  MatchResultOverlayProps,
  'redName' | 'blueName' | 'redScore' | 'blueScore' | 'scoringConfig'
>) {
  const { t } = useI18n();
  const winner = matchWinnerSide(redScore, blueScore);
  const winnerName = winner === 'red' ? redName : winner === 'blue' ? blueName : null;

  return (
    <>
      <p className="mb-3 text-sm font-bold uppercase tracking-[0.3em] text-gold">
        {t('scoring.result.finalResult')}
      </p>
      {winnerName ? (
        <p
          className="mb-2 flex items-center justify-center gap-2 text-3xl font-black animate-pulse"
          // The winner wears their own configured side colour, not gold.
          style={{ color: winner ? sideStyle(scoringConfig, winner).border : undefined }}
        >
          <span aria-hidden>🏆</span> {winnerName}
        </p>
      ) : (
        <p className="mb-2 text-3xl font-black text-foreground">{t('scoring.result.draw')}</p>
      )}
      <p className="mb-4 font-mono text-2xl font-bold text-foreground-secondary">
        {redScore} – {blueScore}
      </p>
    </>
  );
}

/**
 * The review itself: the flow chart and the numbered timeline, sharing one
 * highlight so scrubbing either lights the other. Both read from the rows this
 * component fetches once, on mount — which is the moment the bout ended.
 */
function BoutReview({
  apiUrl,
  matchId,
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
  refreshKey,
}: Omit<MatchResultOverlayProps, 'redScore' | 'blueScore' | 'nextMatchHref' | 'onClose'>) {
  const { t } = useI18n();
  const [highlight, setHighlight] = useState<number | null>(null);
  const { active: exchanges } = useExchanges(apiUrl, matchId, refreshKey);
  const { active: penalties } = usePenalties(apiUrl, matchId, refreshKey);

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
        surface="dark"
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
          scoringConfig={scoringConfig}
        />
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
