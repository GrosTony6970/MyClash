import { entrantKindMismatch } from '../../common/entrant-kind-refusal';
import type { EntrantKind } from '../events/tournament-kind';

/**
 * The columns a Pool of a Tournament of `kind` writes its entrants into: the seat, and the two
 * sides of each bout (0282). A team Tournament's Pools hold teams, an individual one's hold
 * Registrations; the database refuses the other kind (`entrant_kind_holds`).
 */
export function poolEntrantColumns(kind: EntrantKind) {
  return kind === 'team'
    ? ({ member: 'team_id', red: 'red_team_id', blue: 'blue_team_id' } as const)
    : ({
        member: 'registration_id',
        red: 'red_registration_id',
        blue: 'blue_registration_id',
      } as const);
}

/** A Pool seat's two entrant columns, one of them set (`pool_members_one_entrant`, 0282). */
export type PoolSeatColumns = Record<'registration_id' | 'team_id', string | null>;

/** A Pool bout's two sides, in the columns of the kind: Berger's home seat in red, away in blue. */
export function poolBoutSides(
  kind: EntrantKind,
  entrantIds: readonly (string | null)[],
  bout: { homeIndex: number; awayIndex: number },
): Record<string, string> {
  const { red, blue } = poolEntrantColumns(kind);
  return { [red]: entrantIds[bout.homeIndex]!, [blue]: entrantIds[bout.awayIndex]! };
}

/**
 * Refuses a seat of the other kind with the 409 the kind trigger's refusal gives
 * (`entrant_kind_mismatch`): a team into an individual Tournament's Pool, or a Registration into a
 * team Tournament's. Said before any read of the entrant, so the answer names the kind, not a
 * missing id.
 */
export function assertSeatFitsKind(kind: EntrantKind, seat: EntrantKind): void {
  if ((kind === 'team') !== (seat === 'team')) throw entrantKindMismatch();
}
