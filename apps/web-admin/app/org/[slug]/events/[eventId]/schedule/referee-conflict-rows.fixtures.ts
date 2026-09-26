/**
 * Shared fixtures for the live half's two test files (referee-conflict-rows*.test.ts).
 *
 * Every fixture keeps the registration id and the person id visibly different (`reg-*`
 * against `gp-*`): keying on `persons.id` instead of `global_persons.id` produces a join
 * that matches nothing — no rows, no error, a board that looks healthy.
 *
 * Times are asserted from a NEW YORK event, not a Paris one. This machine, the app default
 * zone and the drag fixture are all Europe/Paris, so a Paris assertion agrees with a
 * dropped timezone argument and proves nothing.
 */
import type { RefereeSwitches } from '@myclash/rulesets/scheduling/referee-checker';
import {
  buildRefereeConflictRows,
  type RefereeConflictAssignment,
  type RefereeConflictMatch,
  type RefereeConflictRegistration,
} from './referee-conflict-rows';

export const TZ = 'America/New_York';
export const UNKNOWN = 'Unknown fighter';
/** Shaped like a real id so a leak is obvious. */
export const PERSON_UUID = '6f1e9f42-0000-4000-8000-000000000001';
// Rest and a cap of 1 on as well: the live half has no day slots and no days, so every
// test below also holds that it stays silent on both (the server section says them).
export const ALL_ON: RefereeSwitches = {
  ownPool: true,
  ownPoolSpan: true,
  twoRoles: true,
  attendWorkshop: true,
  restSlots: 1,
  maxBoutsPerDay: 1,
};

export function match(over: Partial<RefereeConflictMatch> & { id: string }): RefereeConflictMatch {
  return {
    matchNumberLabel: over.id,
    liceId: 'lice-1',
    scheduledAt: '2026-06-13T13:00:00Z',
    durationMinutes: 5,
    redRegistrationId: `reg-red-${over.id}`,
    blueRegistrationId: `reg-blue-${over.id}`,
    poolId: null,
    poolName: null,
    tournamentName: 'Longsword',
    ...over,
  };
}

/** A Match-scoped duty on `matchId`. */
export function onBout(
  matchId: string,
  over: Partial<RefereeConflictAssignment> = {},
): RefereeConflictAssignment {
  return {
    scopeType: 'match',
    matchId,
    poolId: null,
    personId: 'gp-denis',
    personName: 'Denis',
    role: 'declarant',
    confirmedReasons: [],
    ...over,
  };
}

/** A Pool-scoped duty on `poolId`. */
export function onPool(
  poolId: string,
  over: Partial<RefereeConflictAssignment> = {},
): RefereeConflictAssignment {
  return onBout('', { scopeType: 'pool', matchId: null, poolId, ...over });
}

export const denisIs = (registrationId: string): RefereeConflictRegistration => ({
  registrationId,
  personId: 'gp-denis',
  personName: 'Denis',
});

export function build(args: {
  matches: RefereeConflictMatch[];
  assignments: RefereeConflictAssignment[];
  registrations: RefereeConflictRegistration[];
  rules?: RefereeSwitches;
}) {
  return buildRefereeConflictRows({
    rules: ALL_ON,
    ...args,
    tz: TZ,
    unknownPersonLabel: UNKNOWN,
  });
}

export const codesOf = (rows: ReturnType<typeof build>) =>
  rows.map((r) => r.reasons.map((x) => x.code));
