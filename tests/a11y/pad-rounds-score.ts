/**
 * How the stubbed server of `pad-rounds-stub.ts` scores a round, and the rules
 * it gives the pad.
 *
 * As the server does, it counts a round again from that round's hits. A bout
 * that counts up gives a hit's points to the hitter. A bout that counts down
 * starts each fighter at the cap and takes a hit's points off the OPPONENT,
 * never under zero.
 */
export interface RoundScore {
  red: number;
  blue: number;
}

export function roundScore(
  hits: ReadonlyArray<Record<string, unknown>>,
  round: number,
  countdown: boolean,
  cap: number,
): RoundScore {
  const earned = { red: 0, blue: 0 };
  for (const hit of hits) {
    if (hit.voided || hit.round_number !== round) continue;
    if (hit.scoringSide === 'red') earned.red += hit.scoreDelta as number;
    if (hit.scoringSide === 'blue') earned.blue += hit.scoreDelta as number;
  }
  if (!countdown) return earned;
  return { red: Math.max(0, cap - earned.blue), blue: Math.max(0, cap - earned.red) };
}

/** The round is over by itself: a fighter at the cap, or at zero in a bout that counts down. */
export const roundOver = (score: RoundScore, countdown: boolean, cap: number) =>
  countdown ? score.red <= 0 || score.blue <= 0 : score.red >= cap || score.blue >= cap;

/** The Tournament's rules as `GET tournaments/:id/match-config` gives them: first to 2. */
const CONFIG = {
  scoringConfig: {
    afterblowMode: 'deductive',
    buttons: {
      clean: [
        { label: '+2', value: 2, visible: true },
        { label: '+1', value: 1, visible: true },
      ],
      afterblow: [],
    },
    display: { sideColors: { red: 'red', blue: 'blue' } },
  },
  matchFormat: {
    pointCap: 2,
    scoringDirection: 'normal',
    timerMode: 'countdown',
    timeLimitsSeconds: { pool: 90, bracket: 90, finals: 90 },
    softClockLimitSeconds: 5,
    maxDoubleHits: 4,
    maxDoubleHitOutcome: 'double_loss_zero_scores',
    bestOf: { pool: 3, bracket: 1, finals: 1 },
    levelAtTime: {
      pool: [{ kind: 'draw' }],
      bracket: [{ kind: 'sudden_death' }],
      finals: [{ kind: 'sudden_death' }],
    },
  },
};

/** The rules, in the direction the bout counts, with the cap of a round. */
export const rulesOf = (countdown: boolean, pointCap: number) => ({
  ...CONFIG,
  matchFormat: {
    ...CONFIG.matchFormat,
    pointCap,
    scoringDirection: countdown ? 'reverse_zero_loses' : 'normal',
  },
});

/** The same rules as a bout read carries them (`rules`, ruling K), pinning the built-in cards. */
export const boutRules = (countdown: boolean, pointCap: number) => {
  const { scoringConfig, matchFormat } = rulesOf(countdown, pointCap);
  return {
    matchFormat,
    afterblowMode: scoringConfig.afterblowMode,
    buttons: scoringConfig.buttons,
    cardRulesetId: null,
  };
};
