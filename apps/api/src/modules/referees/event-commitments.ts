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
 *     Match-scoped row;
 *   - teaching and attending are the Workshop session's own times.
 * And the targets: a board unit for the picker and Assign, an existing row for a re-judge.
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

export interface CommitmentInputs {
  units: readonly AssignmentBoardPool[];
  /** Registration id → `global_persons.id` of its fighter. */
  personIdByRegistration: ReadonlyMap<string, string>;
  assignments: readonly BoardAssignmentRow[];
  sessions: readonly WorkshopSessionCommitments[];
}

/** The Discouraged rules' switches, from the Event's referee settings. */
export function switchesOf(
  settings: Pick<
    PoolAssignmentSettings,
    'enableOwnPoolRule' | 'enableOwnPoolSpanRule' | 'enableTwoRolesRule' | 'workshopConflictWarning'
  >,
): RefereeSwitches {
  return {
    ownPool: settings.enableOwnPoolRule,
    ownPoolSpan: settings.enableOwnPoolSpanRule,
    twoRoles: settings.enableTwoRolesRule,
    attendWorkshop: settings.workshopConflictWarning,
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
    return [
      {
        kind: 'referee',
        personId: row.person_id,
        unitId: unit.id,
        poolId: poolIdOf(unit),
        matchId: row.match_id,
        role: row.role,
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
  dayIndexOf: (iso: string) => number | null,
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
    dayIndex: unit.scheduledStart ? dayIndexOf(unit.scheduledStart) : null,
  };
}

/** An existing row as its own target: the whole Pool, or its one bout. */
export function assignmentTarget(
  row: BoardAssignmentRow & { role: string },
  unit: AssignmentBoardPool,
  dayIndexOf: (iso: string) => number | null,
): RefereeTarget {
  const whole = unitTarget(unit, row.role, dayIndexOf);
  const bout = row.match_id ? unit.matches.find((m) => m.id === row.match_id) : undefined;
  if (!bout) return whole;
  return {
    ...whole,
    scope: 'match',
    matchIds: [bout.id],
    window: boutWindowMs(bout),
    dayIndex: bout.scheduledAt ? dayIndexOf(bout.scheduledAt) : null,
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
