'use client';

/**
 * The step of a level bout: "Extra time 60s", then "Sudden death".
 *
 * It acts on this screen at once and is sent behind, with a network or with
 * none, as a clock press is (operator ruling 13): it is written on the tablet
 * as a row of the bout's queue, in the bout's own order. The clock's fold reads
 * it (`clockAfterLevel`): the step is counted, a clock that runs is paused, and
 * extra time is on the clock. A refusal comes a moment later. The row is then
 * held in the inbox, the clock goes back to the server's, and the reason is
 * said at the clock.
 */
import { useCallback } from 'react';
import type { LevelStep, MatchFormatConfig } from '@myclash/types';
import type { MatchInfo } from '../components/MatchView';
import { effectiveTimeLimitSeconds } from '../components/scoreboard-clock';
import { boutNames } from '../lib/held-hit';
import { levelPressOf } from '../offline/pad-clock';
import { queueLevelPress } from '../offline/press-queue';
import { writeHit } from './useScoringSubmit';

interface LevelStepArgs {
  match: MatchInfo;
  matchFormat: MatchFormatConfig;
  /** The step the bout waits for on this screen, or null. */
  pending: LevelStep | null;
  /** The steps the round has taken on this screen. */
  stepsTaken: number;
  /** The round open on this screen. */
  round: number;
  syncEngine: Parameters<typeof writeHit>[1];
  /** This screen just wrote a press: read the queue now. */
  pressed: () => void;
  setError: (message: string | null) => void;
  t: (key: string) => string;
}

/** Writes the pending step on the tablet. With no step pending it does nothing. */
export function useLevelStep(args: LevelStepArgs): () => void {
  const { match, matchFormat, pending, stepsTaken, round, syncEngine, pressed, setError, t } = args;
  const bout = boutNames(match);
  const limitSeconds = effectiveTimeLimitSeconds(
    matchFormat,
    match.phaseType ?? undefined,
    match.matchNumberLabel,
  );
  const level = levelPressOf(pending, stepsTaken, limitSeconds);
  return useCallback(
    () => {
      if (!level) return;
      setError(null);
      void writeHit(
        async () => {
          await queueLevelPress({ matchId: match.id, round, level, bout });
        },
        syncEngine,
        pressed,
      ).then((written) => {
        if (written === 'not_saved') setError(t('scoring.lice.hitNotSaved'));
      });
    },
    // `bout` and `level` are plain values of the bout's row and of the chain:
    // their fields are the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      match.id,
      round,
      level?.step,
      level?.kind,
      level?.seconds,
      level?.limitMs,
      bout.label,
      bout.red,
      bout.blue,
      syncEngine,
      pressed,
      setError,
      t,
    ],
  );
}
