import { isOutstanding, type ReadinessCheck, type ReadinessReport } from './readiness-copy';

/**
 * The readiness report, re-projected as the morning's sequence.
 *
 * NOT a second engine. The rules, the levels and the copy all still come from
 * `event-readiness.ts` on the server; this only decides what ORDER to read them
 * in, which is a different question from the one the readiness panel answers.
 *
 * The panel groups by tournament, because that is how an organiser fixes things
 * the week before: open Longsword, sort it out, open Rapier. That grouping is
 * useless on the morning, when there is one question — what has to be true
 * before pool 1 match 1 — and the answer is a chain where each link depends on
 * the one above it. A gap in stage 2 makes every check below it unanswerable,
 * so showing them all flat invites someone to start in the wrong place.
 */

export type StageKey = 'event' | 'roster' | 'draw' | 'run';

/**
 * The chain, in dependency order.
 *
 * - `event`   — there is something to run, with people in it and a ruleset.
 * - `roster`  — what we know about those people is good. Deliberately BEFORE
 *               the draw: an unlinked fighter is cheap to fix now and
 *               impossible to fix once results exist against them.
 * - `draw`    — a format and the pools/rounds/bracket generated from it.
 * - `run`     — pistes, times and referees. Only answerable once a draw exists,
 *               which is exactly why it is last.
 *
 * A key not listed here still renders, in the last stage, rather than
 * vanishing — a new server check must never be silently dropped from the
 * morning list just because nobody updated this file.
 */
const STAGE_KEYS: Record<StageKey, readonly string[]> = {
  event: ['tournaments', 'fighters', 'ruleset'],
  roster: ['rosterIdentity', 'rosterClub', 'rosterRatings'],
  draw: ['format', 'pools', 'swissRounds', 'bracket'],
  run: ['pistes', 'schedule', 'poolReferees'],
};

export const STAGE_ORDER: readonly StageKey[] = ['event', 'roster', 'draw', 'run'];

export interface StartOfDayStage {
  key: StageKey;
  /** Checks in this stage, outstanding first. */
  checks: ReadinessCheck[];
  outstandingCount: number;
  /**
   * True for the FIRST stage that still has outstanding work — the one thing
   * the organiser should be looking at. Every stage below it is likely blocked
   * on this one, and every stage above it is done.
   */
  current: boolean;
}

/** Which stage a check belongs to. Unknown keys fall to the last stage. */
export function stageOf(checkKey: string): StageKey {
  for (const stage of STAGE_ORDER) {
    if (STAGE_KEYS[stage].includes(checkKey)) return stage;
  }
  return 'run';
}

/**
 * Group the report into the four stages, in order.
 *
 * Every stage is returned even when empty, so the morning list is a stable
 * shape the organiser can learn rather than a set of sections that appear and
 * disappear as work is done.
 */
export function buildStartOfDay(report: ReadinessReport): StartOfDayStage[] {
  const byStage = new Map<StageKey, ReadinessCheck[]>(STAGE_ORDER.map((key) => [key, []]));
  for (const check of report.checks) {
    byStage.get(stageOf(check.key))?.push(check);
  }

  const stages = STAGE_ORDER.map((key) => {
    const checks = sortOutstandingFirst(byStage.get(key) ?? []);
    return {
      key,
      checks,
      outstandingCount: checks.filter(isOutstanding).length,
      current: false,
    };
  });

  // Exactly one stage is `current`: the first with work left. When everything
  // is clear none is, which is what lets the view say "you are ready" instead
  // of pointing at a stage with nothing in it.
  const first = stages.find((stage) => stage.outstandingCount > 0);
  if (first) first.current = true;
  return stages;
}

/**
 * Outstanding rows first, then the rest in their server order.
 *
 * Within a stage the organiser wants the work, not the receipt. Cleared rows
 * stay visible underneath rather than being filtered out — "pools: 4 created"
 * is how you confirm you are looking at the right event.
 */
function sortOutstandingFirst(checks: ReadinessCheck[]): ReadinessCheck[] {
  return [...checks].sort((a, b) => Number(isOutstanding(b)) - Number(isOutstanding(a)));
}
