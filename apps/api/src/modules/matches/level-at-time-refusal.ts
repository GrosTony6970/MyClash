/**
 * apps/api/src/modules/matches/level-at-time-refusal.ts
 *
 * Why a bout that is LEVEL will not be stopped, in words a referee can act on.
 *
 * In its own file beside `time-limit-result.ts` and `reopen-match-columns.ts`,
 * and for the same reasons: `ClockService` is at its line budget, and this is
 * the copy TWO services now have to agree on. A single bout is refused by the
 * clock; a ROUND of a best-of match is refused by `ScoringService.endRoundOnTime`,
 * which used to throw a bare string of its own — no `code`, so `refusal-copy.ts`
 * fell through to `failure.detail` and put the server's English on a French
 * referee's tablet.
 *
 * The messages are English on purpose: a 4xx body is written for whoever reads
 * the logs, and `refusal-copy.ts` exists so the tablet never shows one. The
 * `code` is the contract the pad maps.
 */
import { BadRequestException } from '@nestjs/common';
import type { LevelStep } from '@myclash/rulesets';
import type { EndRefusal } from './time-limit-result';

/**
 * TWO CODES, because they are two different instructions. `time_not_finished`
 * says keep fighting; `level_at_time_unresolved` says the time is up and the
 * phase has a remedy to play. One code covering both would tell a referee to
 * play sudden death while there was still a minute on the clock.
 */
export function endRefusal(refusal: EndRefusal): BadRequestException {
  if (refusal.reason === 'time_not_finished') {
    return new BadRequestException({
      message: 'Time is not finished — the bout cannot be stopped level before the limit',
      code: 'time_not_finished',
    });
  }
  return levelAtTimeRefusal(refusal.step);
}

/**
 * What the referee does about a bout that is LEVEL now that its time is up.
 *
 * A null step means the chain is spent, which can only mean sudden death is
 * already live: it is terminal, so there is nothing further to advance to and
 * the bout ends when someone LEADS. Not "on the next point" — one exchange can
 * score both fighters, or neither.
 */
export function levelAtTimeRefusal(step: LevelStep | null): BadRequestException {
  const code = 'level_at_time_unresolved';
  if (step === null) {
    return new BadRequestException({
      message: 'Scores are level in sudden death — the bout ends when one fighter leads',
      code,
      remedy: 'sudden_death',
    });
  }
  if (step.kind === 'extra_time') {
    return new BadRequestException({
      message: `Scores are level — play ${step.seconds}s of extra time to decide it`,
      code,
      remedy: 'extra_time',
      seconds: step.seconds,
    });
  }
  return new BadRequestException({
    message: 'Scores are level — play sudden death to decide it',
    code,
    remedy: 'sudden_death',
  });
}
