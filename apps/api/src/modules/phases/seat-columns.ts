import type { EntrantKind } from '../events/tournament-kind';
import type { SideColumns } from '../matches/winner-columns';

/**
 * The two columns of each side a bracket writer names (0282): a slot's sides `a` and `b`, a bout's
 * `red` and `blue`. A side holds a Registration or a team, never both (`*_one_kind`).
 */
const SEATS = {
  a: { registration: 'registration_a_id', team: 'team_a_id' },
  b: { registration: 'registration_b_id', team: 'team_b_id' },
  red: { registration: 'red_registration_id', team: 'red_team_id' },
  blue: { registration: 'blue_registration_id', team: 'blue_team_id' },
} as const;

export type Seat = keyof typeof SEATS;

/** Both columns of one side, by name. */
export type SeatColumns<S extends Seat> = Record<
  (typeof SEATS)[S]['registration'] | (typeof SEATS)[S]['team'],
  string | null
>;

/**
 * One side of a slot or a bout, as the columns a write names: the entrant goes into the column of
 * the Tournament's kind (`storedKind`), the other column is cleared. Every write names both, so a
 * rewrite never leaves the other kind behind. A null id clears the side.
 */
export function seatColumns<S extends Seat>(
  kind: EntrantKind,
  seat: S,
  id: string | null,
): SeatColumns<S> {
  const { registration, team } = SEATS[seat];
  return {
    [registration]: kind === 'team' ? null : id,
    [team]: kind === 'team' ? id : null,
  } as SeatColumns<S>;
}

/** A slot's sides as the slot row holds them. */
export interface SlotSides {
  registration_a_id: string | null;
  registration_b_id: string | null;
  team_a_id: string | null;
  team_b_id: string | null;
}

/** The sides of a slot as generation writes it: no entrant of either kind yet. */
export const EMPTY_SLOT_SIDES: SlotSides = {
  registration_a_id: null,
  registration_b_id: null,
  team_a_id: null,
  team_b_id: null,
};

/**
 * A slot's sides as its bout's columns: side `a` is red, side `b` is blue. The slot was written
 * with `seatColumns`, so each of its sides already names one kind; the bout copies both columns,
 * and the other kind is cleared as it is there.
 */
export function boutSidesOfSlot(slot: SlotSides): SideColumns {
  return {
    red_registration_id: slot.registration_a_id,
    red_team_id: slot.team_a_id,
    blue_registration_id: slot.registration_b_id,
    blue_team_id: slot.team_b_id,
  };
}
