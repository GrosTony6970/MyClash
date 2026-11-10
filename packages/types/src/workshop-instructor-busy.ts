/**
 * When a Workshop's instructor fights or referees (rulings 553-555): the Workshop board turns a
 * card red when one of its instructors is busy elsewhere at that time. The server sends the busy
 * times of the Event's instructors only; the board does the overlap.
 */
export interface WorkshopInstructorBusy {
  /** `global_persons.id`, as on a Workshop's instructor row. */
  personId: string;
  /** `fight`: their whole Pool or Swiss round, or one bracket bout. `referee`: one duty. */
  kind: 'fight' | 'referee';
  /** The Tournament and the unit, as the referee board names it ("Longsword Open · Pool 3"). */
  label: string;
  startsAt: string;
  endsAt: string;
}

export interface WorkshopInstructorBusyResult {
  busy: WorkshopInstructorBusy[];
}
