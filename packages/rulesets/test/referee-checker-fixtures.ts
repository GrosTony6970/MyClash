// Shared fixtures for the referee checker's two test files (src/scheduling/referee-checker*.test.ts).
// It lives under test/ so the emit build never ships it.
import {
  ANY_AVAILABILITY,
  checkReferee,
  type RefereeCommitment,
  type RefereeSwitches,
  type RefereeTarget,
} from '../src/scheduling/referee-checker';

export const LEA = 'lea';
export const MIN = 60_000;
export const T0 = Date.parse('2026-10-03T08:00:00Z');
/** Minutes after 08:00 UTC, as a half-open window. */
export const w = (from: number, to: number) => ({ startMs: T0 + from * MIN, endMs: T0 + to * MIN });

export const ALL_ON: RefereeSwitches = {
  ownPool: true,
  ownPoolSpan: true,
  twoRoles: true,
  attendWorkshop: true,
  restSlots: 1,
  maxBoutsPerDay: 0,
};
export const ALL_OFF: RefereeSwitches = {
  ownPool: false,
  ownPoolSpan: false,
  twoRoles: false,
  attendWorkshop: false,
  restSlots: 0,
  maxBoutsPerDay: 0,
};

/** Pool B, 10:00–11:00, a Pool-scoped crew slot. */
export const poolB: RefereeTarget = {
  scope: 'pool',
  unitId: 'pool-b',
  poolId: 'pool-b',
  groupId: 'pool-b',
  matchIds: ['b1', 'b2'],
  window: w(120, 180),
  role: 'declarant',
  tournamentId: 'longsword',
  dayIndex: 0,
  slot: 1,
};

export const fight = (
  matchId: string,
  poolId: string | null,
  window: ReturnType<typeof w> | null = w(125, 130),
): RefereeCommitment => ({
  kind: 'fight',
  personId: LEA,
  matchId,
  groupId: poolId,
  window,
  label: `bout ${matchId}`,
});
export const fightPool = (
  groupId: string,
  window: ReturnType<typeof w> | null,
): RefereeCommitment => ({
  kind: 'fight-pool',
  personId: LEA,
  groupId,
  window,
  label: `Pool ${groupId}`,
});
export const duty = (
  unitId: string,
  window: ReturnType<typeof w> | null,
  extra: Partial<{
    poolId: string | null;
    matchId: string | null;
    role: string;
    personId: string;
    matchIds: string[];
    slot: number | null;
    dayIndex: number | null;
  }> = {},
): RefereeCommitment => ({
  kind: 'referee',
  personId: extra.personId ?? LEA,
  unitId,
  poolId: extra.poolId ?? null,
  matchId: extra.matchId ?? null,
  role: extra.role ?? 'assesseur',
  matchIds: extra.matchIds ?? (extra.matchId ? [extra.matchId] : []),
  slot: extra.slot ?? null,
  dayIndex: extra.dayIndex ?? null,
  window,
  label: `unit ${unitId}`,
});

export function check(
  commitments: RefereeCommitment[],
  target: RefereeTarget = poolB,
  switches = ALL_ON,
  availability = ANY_AVAILABILITY,
) {
  return checkReferee({ personId: LEA, target, commitments, availability, switches });
}
export const codes = (v: ReturnType<typeof check>) => v.reasons.map((r) => r.code);
