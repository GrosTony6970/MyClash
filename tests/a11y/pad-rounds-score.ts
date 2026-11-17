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

/** A Tournament's protest limit, and the ref of the penalty offered past it (`display.protests`). */
export interface ProtestRules {
  limit: number | null;
  offerPenaltyRef: string;
}

/** The Tournament's rules as `/match-config` gives them, with its protest rules when it has some. */
export function matchConfigOf(countdown: boolean, pointCap: number, protests?: ProtestRules) {
  const rules = rulesOf(countdown, pointCap);
  if (!protests) return rules;
  const display = { ...rules.scoringConfig.display, protests };
  return { ...rules, scoringConfig: { ...rules.scoringConfig, display } };
}

/**
 * The penalty list: none, or the one entry the protest rules offer, its ref as text as the API
 * sends it. A break screen that offered a card would find it.
 */
export const penaltyListOf = (protests?: ProtestRules) =>
  protests
    ? {
        id: 'list-1',
        name: 'House list',
        accumulation_scope: 'match',
        penalty_ruleset_entries: [
          {
            id: 'entry-offered',
            group_number: 8,
            ref_number: protests.offerPenaltyRef,
            short_name: 'Contestation abusive',
            description: 'Contestation abusive, in full',
            sanctions: ['red'],
          },
        ],
      }
    : null;

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
