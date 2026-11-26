'use client';

import { useMemo, useState } from 'react';
import { BoutFlowChart, MatchTimeline, buildBoutFlow, buildUnifiedTimeline } from '@myclash/ui';
import { DEFAULT_MATCH_FORMAT_CONFIG, DEFAULT_SCORING_CONFIG } from '@myclash/types';
import { useI18n } from '@myclash/next-i18n/client';
import type {
  ExchangeRow,
  MatchPenaltyRow,
  MatchProtest,
  MatchRow,
  MatchSummary,
} from './match-row';

/** The bout's momentum chart and its history, under the scoreboard of the public match page. */
export function MatchEventFeed({
  exchanges,
  penalties,
  protests,
  match,
  summary,
  redName,
  blueName,
}: {
  exchanges: ExchangeRow[];
  penalties: MatchPenaltyRow[];
  protests: MatchProtest[];
  match: MatchRow;
  summary: MatchSummary;
  redName: string;
  blueName: string;
}) {
  const { t } = useI18n();
  const [highlight, setHighlight] = useState<number | null>(null);
  // The tournament's own config now reaches this page (via /summary), so the
  // timeline paints the operator's side colours like every other surface.
  const config = summary.scoringConfig ?? DEFAULT_SCORING_CONFIG;

  // The same builder the referee pad and the TV display use, so a spectator's
  // "#6" is the operator's "#6": exchanges and cards in ONE contiguous 1..N
  // sequence, newest first. Voided rows are dropped by the builder; they are
  // still counted below so the page keeps disclosing that they existed.
  const events = useMemo(
    () =>
      buildUnifiedTimeline({
        exchanges,
        penalties,
        // History rows only: this page keeps no protest counter.
        protests,
        redName,
        blueName,
        // Side keys: a team card or protest names its team, and is placed on that team's side.
        redSideId: match.redSideId,
        blueSideId: match.blueSideId,
        t,
        config,
      }),
    [
      exchanges,
      penalties,
      protests,
      redName,
      blueName,
      match.redSideId,
      match.blueSideId,
      config,
      t,
    ],
  );

  // The same rows read as momentum. No pause markers: they need the clock
  // endpoint, which this page does not fetch (and which is not yet @Public).
  const flow = useMemo(
    () =>
      buildBoutFlow({
        exchanges,
        penalties,
        redSideId: match.redSideId,
        blueSideId: match.blueSideId,
        matchFormat: summary.matchFormat ?? DEFAULT_MATCH_FORMAT_CONFIG,
        phaseType: summary.phaseType,
        endReason: match.endReason,
        bestOf: summary.bestOf,
        currentRound: match.currentRound,
      }),
    [exchanges, penalties, match, summary],
  );

  // Exchange-scoped ON PURPOSE: the string says "voided exchanges", so folding
  // voided cards into the same number would misreport them as exchanges.
  const voidedExchanges = exchanges.filter((e) => e.voided).length;
  const header = t('scoring.lice.eventsHeader');

  return (
    <div className="mt-4">
      <BoutFlowChart
        series={flow}
        config={config}
        redName={redName}
        blueName={blueName}
        redColour={summary.redColour}
        blueColour={summary.blueColour}
        surface="light"
        scale="page"
        highlightNumber={highlight}
        onHighlightChange={setHighlight}
        t={t}
        className="mb-4"
      />

      <h2 className="mb-2 text-sm font-semibold tracking-wide text-muted uppercase">{header}</h2>

      <MatchTimeline
        events={events}
        scale="page"
        emptyLabel={t('scoring.liveMatch.noExchanges')}
        ariaLabel={header}
        highlightNumber={highlight}
        onHighlightChange={setHighlight}
        redColour={summary.redColour}
        blueColour={summary.blueColour}
        t={t}
      />

      {voidedExchanges > 0 && (
        <p className="mt-3 text-center text-xs text-muted">
          {t('scoring.liveMatch.voidedHidden', {
            count: String(voidedExchanges),
            plural: voidedExchanges > 1 ? 's' : '',
          })}
        </p>
      )}
    </div>
  );
}
