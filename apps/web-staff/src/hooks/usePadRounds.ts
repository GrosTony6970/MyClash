'use client';

/**
 * The rounds of the bout on screen, and its two round buttons.
 *
 * The view is `padSeries` (the server's row, its hits, and what the tablet
 * still holds), behind the screen's own memory of what it showed a moment ago
 * (`rememberSeries`: the race it handles is named there). A bout of one round
 * goes through the same view, with one round.
 *
 * "Start round N" and "End round" act on this screen at once and are sent
 * behind, with a network or with none, as a clock press is (operator,
 * 2026-10-10): each is written on the tablet as a row of the bout's queue. A
 * refusal comes a moment later. The row is then held in the inbox, the view
 * goes back to the server's row, and the reason is said at the clock.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MatchFormatConfig } from '@myclash/types';
import { endRefusedOnPad } from '../components/end-guard';
import type { MatchInfo } from '../components/MatchView';
import { elapsedActiveMs, type ClockState } from '../components/scoreboard-clock';
import { boutNames } from '../lib/held-hit';
import { endRefusalMessage } from '../lib/refusal-copy';
import { padSeries, type PadSeries, type ServerRounds } from '../offline/pad-series';
import { forgotten, showSeries, type SeriesMemory } from '../offline/pad-series-memory';
import { queueRoundPress } from '../offline/press-queue';
import type { SyncEngine } from '../offline/sync';
import type { MatchScoringData } from './useMatchScoringData';
import { writeHit } from './useScoringSubmit';

type Translate = Parameters<typeof endRefusalMessage>[1];

export interface PadRounds {
  isBestOf: boolean;
  bestOf: number;
  /** The rounds as the screen shows them. */
  series: PadSeries;
  /** "Start round N+1", at the round break. */
  startNextRound: () => void;
  /** "End round": the round goes to the leader of the score on the screen. */
  endRound: () => void;
  /** The official took an entry back: what the screen remembered no longer holds. */
  forget: () => void;
}

interface PadRoundsArgs {
  match: MatchInfo;
  matchFormat: MatchFormatConfig;
  scoring: Pick<
    MatchScoringData,
    | 'activeExchanges'
    | 'activePenalties'
    | 'pendingExchanges'
    | 'pendingPenalties'
    | 'queuedRoundPresses'
  >;
  clockState: ClockState | null;
  /** A row of this bout is held in the inbox. */
  held: boolean;
  syncEngine: Pick<SyncEngine, 'sendBehind'> | null | undefined;
  /** This screen just wrote a press: the clock reads the queue now. */
  pressed: () => void;
  setError: (message: string | null) => void;
  /** Reads the bout again from the server. */
  readBout: () => void;
  t: Translate;
}

/** The server's row of the bout, as far as the rounds read it. */
function useServerRounds(match: MatchInfo): ServerRounds {
  const { currentRound, awaitingRoundAdvance, status, roundsJson, redScore, blueScore } = match;
  return useMemo(
    () => ({
      currentRound: currentRound ?? 1,
      awaitingRoundAdvance: !!awaitingRoundAdvance,
      over: status === 'completed' || status === 'voided',
      roundsJson,
      redScore,
      blueScore,
    }),
    [currentRound, awaitingRoundAdvance, status, roundsJson, redScore, blueScore],
  );
}

/** The rounds computed from what the server and the tablet hold now (`padSeries`). */
function useSeriesNow({ match, matchFormat, scoring, held }: PadRoundsArgs): PadSeries {
  const bestOf = match.bestOf ?? 1;
  const phaseType = match.phaseType ?? undefined;
  const server = useServerRounds(match);
  const { matchNumberLabel, redRegistrationId, blueRegistrationId } = match;
  const { activeExchanges, activePenalties, pendingExchanges, pendingPenalties } = scoring;
  const { queuedRoundPresses } = scoring;
  return useMemo(
    () =>
      padSeries({
        bestOf,
        phaseType,
        matchNumberLabel,
        matchFormat,
        server,
        redRegistrationId,
        blueRegistrationId,
        exchanges: activeExchanges,
        penalties: activePenalties,
        queued: pendingExchanges,
        queuedPenalties: pendingPenalties,
        roundPresses: queuedRoundPresses,
        held,
      }),
    [
      bestOf,
      phaseType,
      matchNumberLabel,
      matchFormat,
      server,
      redRegistrationId,
      blueRegistrationId,
      activeExchanges,
      activePenalties,
      pendingExchanges,
      pendingPenalties,
      queuedRoundPresses,
      held,
    ],
  );
}

/**
 * The rounds to SHOW: the view computed now, behind what this screen showed
 * last for this bout (`pad-series-memory.ts`).
 */
function useSeriesShown(now: PadSeries, args: PadRoundsArgs) {
  const { match, held, readBout } = args;
  const bestOf = match.bestOf ?? 1;
  // Kept as text beside the memory: the memory is built again at each draw,
  // and the state is set only when it DIFFERS, or the draw would never settle.
  const [seen, setSeen] = useState<{ matchId: string; memory: SeriesMemory; text: string } | null>(
    null,
  );
  const before = seen?.matchId === match.id ? seen.memory : null;
  // `match` is a new object at each read of the bout: it is the read's identity.
  const memory = showSeries(now, before, { held, bestOf, read: match });
  const standsOver = memory.over !== null;
  const text = JSON.stringify([memory.view, standsOver, memory.forgotten ?? null]);
  if (seen?.matchId !== match.id || seen.text !== text) {
    setSeen({ matchId: match.id, memory, text });
  }
  // The memory began to stand over the server's view: the queue is empty, so
  // the server holds every row. Its answer is asked for now, and the memory
  // goes when that read lands (`showSeries`).
  useEffect(() => {
    if (standsOver) readBout();
  }, [standsOver, readBout]);
  // The official took an entry back. The queue is read again a moment later:
  // until the view computed changes, nothing is remembered.
  const forget = useCallback(
    () => setSeen({ matchId: match.id, memory: forgotten(now), text: '' }),
    [match.id, now],
  );
  return { series: memory.view, forget };
}

/** Writes a round press on the tablet, as a row of the bout's queue. */
function useRoundPress({ match, syncEngine, pressed, setError, t }: PadRoundsArgs) {
  const bout = boutNames(match);
  return useCallback(
    async (action: 'advance' | 'end', round: number, endScore?: { red: number; blue: number }) => {
      setError(null);
      const written = await writeHit(
        async () => {
          await queueRoundPress({ matchId: match.id, action, round, bout, endScore });
        },
        syncEngine,
        pressed,
      );
      if (written === 'not_saved') setError(t('scoring.lice.hitNotSaved'));
    },
    // `bout` is three strings of the bout's row: its fields are the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [match.id, bout.label, bout.red, bout.blue, syncEngine, pressed, setError, t],
  );
}

export function usePadRounds(args: PadRoundsArgs): PadRounds {
  const { match, matchFormat, clockState, setError, t } = args;
  const bestOf = match.bestOf ?? 1;
  const { series, forget } = useSeriesShown(useSeriesNow(args), args);
  const press = useRoundPress(args);

  const startNextRound = () => void press('advance', series.round + 1);

  // A level round is not ended on the tablet: the two refusals the server
  // gives it are given here first, in the same words, and nothing is queued
  // (`endRefusedOnPad`). A round with a leader ends, as with a network.
  const endRound = () => {
    const refused = endRefusedOnPad({
      matchFormat,
      phaseType: match.phaseType ?? undefined,
      matchNumberLabel: match.matchNumberLabel,
      elapsedMs: elapsedActiveMs(clockState, Date.now()),
      score: { redScore: series.redScore, blueScore: series.blueScore },
      levelStepsTaken: clockState?.levelResolutionSteps ?? 0,
    });
    if (refused) setError(endRefusalMessage(refused, t));
    // The row carries the score it is pressed on: the round is closed on it.
    else void press('end', series.round, { red: series.redScore, blue: series.blueScore });
  };

  return { isBestOf: bestOf > 1, bestOf, series, startNextRound, endRound, forget };
}
