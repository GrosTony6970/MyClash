/**
 * instructor-busy.ts — when the Event's Workshop instructors fight or referee (rulings 553-555),
 * for the Workshop board's red card. The board does the overlap; this picks the times.
 *
 * Pools and duties come from the commitments the referee checker reads (`event-commitments.ts`,
 * ADR-016), so the two boards agree about them:
 *   - a fighter is busy for their whole Pool (`fight-pool`, the 2026-09-17 ruling); a bout of the
 *     Pool lies inside it, so it would only repeat it;
 *   - a referee duty: its Pool's span or its bout's window.
 *
 * A Swiss phase and an elimination bracket are one block each, as on the fighter's own schedule
 * (operator, 2026-11-23): busy for the whole Swiss phase, and for the bracket from its first bout,
 * whoever fights it, until they are out. The referee checker keeps its own per-round and per-bout
 * windows; this is the Workshop board's reading only.
 *
 * Teaching and attending are left out: the board has the Workshops itself, and an attendance is a
 * private booking (ADR-016, migration 0205).
 *
 * Pure: no I/O.
 */
import type { RefereeCommitment } from '@myclash/rulesets/scheduling/referee-checker';
import { hullMs } from '@myclash/schedule-core';
import type { WorkshopInstructorBusy } from '@myclash/types';
import { eliminationEnd, type BracketBout } from '../persons/elimination-end';
import type { AssignmentBoardPool } from './assignment-board.service';
import { boutWindowMs } from './board-unit-ends';

/** A bout's status and recorded winner, read for the instructors' elimination bouts. */
export interface BoutResult {
  status: string;
  winnerRegistrationId: string | null;
}

/** A Pool and a duty: from the checker's commitments. Swiss rounds and bracket bouts are blocks. */
function commitmentKind(commitment: RefereeCommitment): WorkshopInstructorBusy['kind'] | null {
  if (commitment.kind === 'fight-pool')
    return commitment.groupId.startsWith('swiss:') ? null : 'fight';
  if (commitment.kind === 'referee') return 'referee';
  return null;
}

function fromCommitments(
  commitments: readonly RefereeCommitment[],
  instructorIds: ReadonlySet<string>,
): WorkshopInstructorBusy[] {
  const busy: WorkshopInstructorBusy[] = [];
  for (const commitment of commitments) {
    const kind = commitmentKind(commitment);
    if (kind === null || commitment.window === null) continue;
    if (!instructorIds.has(commitment.personId)) continue;
    busy.push({
      personId: commitment.personId,
      kind,
      block: null,
      label: commitment.label,
      startsAt: new Date(commitment.window.startMs).toISOString(),
      endsAt: new Date(commitment.window.endMs).toISOString(),
    });
  }
  return busy;
}

type Bout = AssignmentBoardPool['matches'][number];

interface Block {
  block: 'elimination' | 'swiss';
  tournamentName: string;
  bouts: Bout[];
}

/** One block per Tournament and kind: its bracket (bracket + finals units), its Swiss phase. */
function blocksOf(units: readonly AssignmentBoardPool[]): Block[] {
  const blocks = new Map<string, Block>();
  for (const unit of units) {
    const kind = unit.kind ?? 'pool';
    if (kind === 'pool') continue;
    const block = kind === 'swiss' ? 'swiss' : 'elimination';
    const key = `${unit.tournamentId}:${block}`;
    const entry = blocks.get(key) ?? { block, tournamentName: unit.tournamentName, bouts: [] };
    entry.bouts.push(...unit.matches);
    blocks.set(key, entry);
  }
  return [...blocks.values()];
}

/** The person's own bouts of a block, as `eliminationEnd` reads them; a bout not read is still to fight. */
function ownBouts(
  bouts: readonly Bout[],
  registrations: ReadonlySet<string>,
  results: ReadonlyMap<string, BoutResult>,
): BracketBout[] {
  return bouts.flatMap((bout) => {
    const own = [bout.redRegistrationId, bout.blueRegistrationId].find(
      (reg) => reg !== null && registrations.has(reg),
    );
    if (!own) return [];
    const result = results.get(bout.id);
    const status = result?.status ?? 'scheduled';
    // A completed bout they did not win put them out; a bout with no winner (both out) too.
    const outcome =
      status === 'completed' ? (result?.winnerRegistrationId === own ? 'win' : 'loss') : null;
    return [
      {
        status,
        outcome,
        scheduledAt: bout.scheduledAt,
        durationMinutes: bout.durationMinutes,
        fallbackEndsAt: null,
      },
    ];
  });
}

/** Each instructor's Swiss phases and brackets, one entry each, cut where they are out. */
function fromBlocks(
  units: readonly AssignmentBoardPool[],
  personIdByRegistration: ReadonlyMap<string, string>,
  instructorIds: ReadonlySet<string>,
  results: ReadonlyMap<string, BoutResult>,
): WorkshopInstructorBusy[] {
  const registrationsOf = new Map<string, Set<string>>();
  for (const [registrationId, personId] of personIdByRegistration) {
    if (!instructorIds.has(personId)) continue;
    registrationsOf.set(personId, (registrationsOf.get(personId) ?? new Set()).add(registrationId));
  }
  const busy: WorkshopInstructorBusy[] = [];
  for (const block of blocksOf(units)) {
    const hull = hullMs(
      block.bouts.flatMap((bout) => {
        const window = boutWindowMs(bout);
        return window ? [window] : [];
      }),
    );
    if (!hull) continue;
    for (const [personId, registrations] of registrationsOf) {
      const own = ownBouts(block.bouts, registrations, results);
      if (own.length === 0) continue;
      const out = block.block === 'elimination' ? eliminationEnd(own) : null;
      busy.push({
        personId,
        kind: 'fight',
        block: block.block,
        label: block.tournamentName,
        startsAt: new Date(hull.startMs).toISOString(),
        endsAt: out ?? new Date(hull.endMs).toISOString(),
      });
    }
  }
  return busy;
}

export interface InstructorBusyInputs {
  commitments: readonly RefereeCommitment[];
  units: readonly AssignmentBoardPool[];
  /** Registration id → `global_persons.id` of its fighter. */
  personIdByRegistration: ReadonlyMap<string, string>;
  instructorIds: ReadonlySet<string>;
  /** The status and winner of the instructors' elimination bouts, by bout id. */
  results: ReadonlyMap<string, BoutResult>;
}

export function instructorBusy(inputs: InstructorBusyInputs): WorkshopInstructorBusy[] {
  return [
    ...fromCommitments(inputs.commitments, inputs.instructorIds),
    ...fromBlocks(
      inputs.units,
      inputs.personIdByRegistration,
      inputs.instructorIds,
      inputs.results,
    ),
  ].sort((a, b) => a.personId.localeCompare(b.personId) || a.startsAt.localeCompare(b.startsAt));
}

/** The instructors' own elimination bouts, whose results `instructorBusy` needs. */
export function eliminationBoutIds(
  units: readonly AssignmentBoardPool[],
  personIdByRegistration: ReadonlyMap<string, string>,
  instructorIds: ReadonlySet<string>,
): string[] {
  return units.flatMap((unit) =>
    unit.kind === 'bracket' || unit.kind === 'finals'
      ? unit.matches
          .filter((bout) =>
            [bout.redRegistrationId, bout.blueRegistrationId].some((reg) => {
              const person = reg ? personIdByRegistration.get(reg) : undefined;
              return person !== undefined && instructorIds.has(person);
            }),
          )
          .map((bout) => bout.id)
      : [],
  );
}
