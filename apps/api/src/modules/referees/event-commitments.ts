/**
 * event-commitments.ts — the referee board's loaded Event, as the one checker reads it.
 *
 * `@myclash/rulesets/scheduling/referee-checker` answers "may this person referee this
 * unit?" from a person's commitments, each already windowed (ADR-016, ADR-017). This file
 * is the one place the API builds them, from what the board already loaded:
 *   - a fight is one bout's window, for each of its two fighters;
 *   - a fight-pool is the hull of a group a person fights in: a Pool (its members and its
 *     bouts' fighters), or a Swiss round across its pistes (every competitor of the round);
 *   - a referee duty is a Pool's hull for a Pool-scoped row, one bout's window for a
 *     Match-scoped row, with the bouts it covers, its day and its unit's day slot;
 *   - teaching and attending are the Workshop session's own times.
 * And the targets: a board unit for the picker and Assign, an existing row for a re-judge.
 *
 * The day slots of ADR-019's rest are built here too (`boardClock`): a slot is a distinct
 * start time of the day's Pools and Swiss units on the Event clock, in time order. A
 * bracket bout makes none and sits in none (ruling 139).
 *
 * It also builds the slate (`RefereeCommitmentPool[]`) the capacity warning reads, from the
 * same units, so the warning and the verdicts cannot disagree about who fights when.
 *
 * Nothing here stores a window: they are measured from the bouts on every read.
 *
 * Pure: no I/O.
 */
import type {
  RefereeAvailability,
  RefereeCommitment,
  RefereeSwitches,
  RefereeTarget,
} from '@myclash/rulesets/scheduling/referee-checker';
import type { RefereeCommitmentPool } from '@myclash/types';
import type { TimeWindowMs } from '@myclash/schedule-core';
import { boutWindowMs, unitWindowMs } from './board-unit-ends';
import type { AssignmentBoardCandidate, AssignmentBoardPool } from './assignment-board.service';
import type { PoolAssignmentSettings } from './settings.service';
import type { WorkshopSessionCommitments } from './workshop-sessions';

/** One persisted `referee_assignments` row, as the board reads it. */
export interface BoardAssignmentRow {
  id: string;
  person_id: string;
  pool_id: string | null;
  match_id: string | null;
  role: string | null;
}

/** Where a unit sits in the Event's days: its day index, and its day slot (ADR-019). */
export interface BoardClock {
  dayIndexOf: (iso: string) => number | null;
  slotOf: (unit: Pick<AssignmentBoardPool, 'id'>) => number | null;
}

/**
 * The Event's day slots, from its units: per day, the distinct start times of its Pools
 * and Swiss units in time order. Two units that start at the same minute share a slot.
 */
export function boardClock(
  units: readonly AssignmentBoardPool[],
  dayIndexOf: (iso: string) => number | null,
): BoardClock {
  const startsByDay = new Map<number, Set<number>>();
  const placed: Array<{ id: string; day: number; startMs: number }> = [];
  for (const unit of units) {
    if ((unit.kind ?? 'pool') !== 'pool' && unit.kind !== 'swiss') continue;
    if (!unit.scheduledStart) continue;
    const day = dayIndexOf(unit.scheduledStart);
    if (day === null) continue;
    const startMs = Date.parse(unit.scheduledStart);
    startsByDay.set(day, (startsByDay.get(day) ?? new Set<number>()).add(startMs));
    placed.push({ id: unit.id, day, startMs });
  }
  const slotById = new Map<string, number>();
  for (const { id, day, startMs } of placed) {
    const ordered = [...startsByDay.get(day)!].sort((a, b) => a - b);
    slotById.set(id, ordered.indexOf(startMs));
  }
  return { dayIndexOf, slotOf: (unit) => slotById.get(unit.id) ?? null };
}

export interface CommitmentInputs {
  units: readonly AssignmentBoardPool[];
  clock: BoardClock;
  /** Registration id → `global_persons.id` of its fighter. */
  personIdByRegistration: ReadonlyMap<string, string>;
  assignments: readonly BoardAssignmentRow[];
  sessions: readonly WorkshopSessionCommitments[];
}

/** The Discouraged rules' switches, from the Event's referee settings. */
export function switchesOf(
  settings: Pick<
    PoolAssignmentSettings,
    | 'enableOwnPoolRule'
    | 'enableOwnPoolSpanRule'
    | 'enableTwoRolesRule'
    | 'workshopConflictWarning'
    | 'enforceRefereeNoBackToBack'
    | 'refereeRestMinSlots'
    | 'maxBoutsPerDay'
  >,
): RefereeSwitches {
  return {
    ownPool: settings.enableOwnPoolRule,
    ownPoolSpan: settings.enableOwnPoolSpanRule,
    twoRoles: settings.enableTwoRolesRule,
    attendWorkshop: settings.workshopConflictWarning,
    restSlots: settings.enforceRefereeNoBackToBack ? settings.refereeRestMinSlots : 0,
    maxBoutsPerDay: settings.maxBoutsPerDay,
  };
}

/** The data name a screen shows and a confirm stores: the Tournament and the unit's name. */
export function unitLabel(unit: Pick<AssignmentBoardPool, 'tournamentName' | 'name'>): string {
  return unit.tournamentName ? `${unit.tournamentName} · ${unit.name}` : unit.name;
}

/** The group whose fighters make a unit "their own": the Pool, or the Swiss round. */
export function groupIdOf(unit: AssignmentBoardPool): string | null {
  if ((unit.kind ?? 'pool') === 'pool') return unit.id;
  if (unit.kind === 'swiss' && unit.swissRoundId) return `swiss:${unit.swissRoundId}`;
  return null;
}

function poolIdOf(unit: AssignmentBoardPool): string | null {
  return (unit.kind ?? 'pool') === 'pool' ? unit.id : null;
}

/** Everyone who fights in a unit: its roster and its bouts' two fighters. */
function fightersOf(
  unit: AssignmentBoardPool,
  personIdByRegistration: ReadonlyMap<string, string>,
): Set<string> {
  const people = new Set(unit.members.map((m) => m.personId).filter((id) => id !== ''));
  for (const bout of unit.matches) {
    for (const reg of [bout.redRegistrationId, bout.blueRegistrationId]) {
      const person = reg ? personIdByRegistration.get(reg) : undefined;
      if (person) people.add(person);
    }
  }
  return people;
}

function fightCommitments(inputs: CommitmentInputs): RefereeCommitment[] {
  const out: RefereeCommitment[] = [];
  for (const unit of inputs.units) {
    for (const bout of unit.matches) {
      for (const reg of [bout.redRegistrationId, bout.blueRegistrationId]) {
        const personId = reg ? inputs.personIdByRegistration.get(reg) : undefined;
        if (!personId) continue;
        out.push({
          kind: 'fight',
          personId,
          matchId: bout.id,
          groupId: groupIdOf(unit),
          window: boutWindowMs(bout),
          label: unitLabel(unit),
        });
      }
    }
  }
  return out;
}

/** One fight-pool per person per group, over the hull of every unit of the group. */
function groupCommitments(inputs: CommitmentInputs): RefereeCommitment[] {
  const groups = new Map<string, { units: AssignmentBoardPool[]; people: Set<string> }>();
  for (const unit of inputs.units) {
    const groupId = groupIdOf(unit);
    if (groupId === null) continue;
    const group = groups.get(groupId) ?? { units: [], people: new Set<string>() };
    group.units.push(unit);
    for (const person of fightersOf(unit, inputs.personIdByRegistration)) group.people.add(person);
    groups.set(groupId, group);
  }
  const out: RefereeCommitment[] = [];
  for (const [groupId, group] of groups) {
    const window = unitWindowMs({ matches: group.units.flatMap((u) => u.matches) });
    const label = unitLabel(group.units[0]!);
    for (const personId of group.people) {
      out.push({ kind: 'fight-pool', personId, groupId, window, label });
    }
  }
  return out;
}

/** The unit a row sits on: its Pool, or the unit holding its bout. */
export function unitIndex(units: readonly AssignmentBoardPool[]) {
  const byId = new Map(units.map((u) => [u.id, u]));
  const byMatchId = new Map<string, AssignmentBoardPool>();
  for (const unit of units) for (const bout of unit.matches) byMatchId.set(bout.id, unit);
  return (row: Pick<BoardAssignmentRow, 'pool_id' | 'match_id'>): AssignmentBoardPool | null =>
    (row.pool_id ? byId.get(row.pool_id) : row.match_id ? byMatchId.get(row.match_id) : null) ??
    null;
}

function dutyCommitments(inputs: CommitmentInputs): RefereeCommitment[] {
  const unitOf = unitIndex(inputs.units);
  return inputs.assignments.flatMap((row): RefereeCommitment[] => {
    const unit = unitOf(row);
    if (!unit || !row.role || !row.person_id) return [];
    const bout = row.match_id ? unit.matches.find((m) => m.id === row.match_id) : undefined;
    const start = bout ? bout.scheduledAt : unit.scheduledStart;
    return [
      {
        kind: 'referee',
        personId: row.person_id,
        unitId: unit.id,
        poolId: poolIdOf(unit),
        matchId: row.match_id,
        role: row.role,
        matchIds: bout ? [bout.id] : unit.matches.map((m) => m.id),
        slot: inputs.clock.slotOf(unit),
        dayIndex: start ? inputs.clock.dayIndexOf(start) : null,
        window: bout ? boutWindowMs(bout) : unitWindowMs(unit),
        label: unitLabel(unit),
      },
    ];
  });
}

function sessionWindow(session: WorkshopSessionCommitments): TimeWindowMs | null {
  if (session.startsAt === null || session.endsAt === null) return null;
  return { startMs: Date.parse(session.startsAt), endMs: Date.parse(session.endsAt) };
}

function workshopCommitments(inputs: CommitmentInputs): RefereeCommitment[] {
  return inputs.sessions.flatMap((session) => {
    const common = {
      sessionId: session.sessionId,
      window: sessionWindow(session),
      label: session.title,
    };
    return [
      ...session.instructorIds.map((personId) => ({ kind: 'teach' as const, personId, ...common })),
      ...session.attendeeIds.map((personId) => ({ kind: 'attend' as const, personId, ...common })),
    ];
  });
}

/** Every commitment of everyone in the Event. */
export function buildCommitments(inputs: CommitmentInputs): RefereeCommitment[] {
  return [
    ...fightCommitments(inputs),
    ...groupCommitments(inputs),
    ...dutyCommitments(inputs),
    ...workshopCommitments(inputs),
  ];
}

/** A unit as the picker and Assign would fill it, in one role. */
export function unitTarget(
  unit: AssignmentBoardPool,
  role: string,
  clock: BoardClock,
): RefereeTarget {
  const kind = unit.kind ?? 'pool';
  return {
    scope: kind === 'pool' ? 'pool' : 'match',
    unitId: unit.id,
    poolId: poolIdOf(unit),
    groupId: groupIdOf(unit),
    matchIds: unit.matches.map((m) => m.id),
    window: unitWindowMs(unit),
    role,
    tournamentId: unit.tournamentId,
    dayIndex: unit.scheduledStart ? clock.dayIndexOf(unit.scheduledStart) : null,
    slot: clock.slotOf(unit),
  };
}

/** One bout of a unit as the target, in one role; null when the unit has no such bout. */
export function boutTarget(
  unit: AssignmentBoardPool,
  matchId: string,
  role: string,
  clock: BoardClock,
): RefereeTarget | null {
  const bout = unit.matches.find((m) => m.id === matchId);
  if (!bout) return null;
  return {
    ...unitTarget(unit, role, clock),
    scope: 'match',
    matchIds: [bout.id],
    window: boutWindowMs(bout),
    dayIndex: bout.scheduledAt ? clock.dayIndexOf(bout.scheduledAt) : null,
  };
}

/** An existing row as its own target: the whole Pool, or its one bout. */
export function assignmentTarget(
  row: BoardAssignmentRow & { role: string },
  unit: AssignmentBoardPool,
  clock: BoardClock,
): RefereeTarget {
  const bout = row.match_id ? boutTarget(unit, row.match_id, row.role, clock) : null;
  return bout ?? unitTarget(unit, row.role, clock);
}

/**
 * A duty not written yet, as the checker counts it: an engine proposal on its unit, or
 * one bout of a per-Pool write (`matchId`). Its day and slot are the target's.
 */
export function dutyOn(
  target: RefereeTarget,
  personId: string,
  label: string,
  matchId: string | null = null,
): RefereeCommitment {
  return {
    kind: 'referee',
    personId,
    unitId: target.unitId,
    poolId: target.poolId,
    matchId,
    role: target.role,
    matchIds: target.matchIds,
    slot: target.slot,
    dayIndex: target.dayIndex,
    window: target.window,
    label,
  };
}

/** A referee's declared availability; a person off the roster has declared none. */
export function availabilityOf(
  candidates: readonly Pick<
    AssignmentBoardCandidate,
    'personId' | 'availableTournamentIds' | 'availableDayIndices'
  >[],
): (personId: string) => RefereeAvailability {
  const byPerson = new Map(candidates.map((c) => [c.personId, c]));
  return (personId) => {
    const c = byPerson.get(personId);
    return {
      tournamentIds: c?.availableTournamentIds ?? null,
      dayIndices: c?.availableDayIndices ?? null,
    };
  };
}

/** The slate the capacity warning sweeps, from the same units and fighters. */
export function slatePools(
  units: readonly AssignmentBoardPool[],
  personIdByRegistration: ReadonlyMap<string, string>,
  roleSlotCountOf: (unit: AssignmentBoardPool) => number,
): RefereeCommitmentPool[] {
  return units.map((unit) => ({
    id: unit.id,
    tournamentId: unit.tournamentId,
    scheduledStart: unit.scheduledStart,
    scheduledEnd: unit.scheduledEnd,
    roleSlotCount: roleSlotCountOf(unit),
    fighterPersonIds: [...fightersOf(unit, personIdByRegistration)],
  }));
}
