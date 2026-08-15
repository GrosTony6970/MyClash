import { cascadeBlockShift, type CascadeBlock } from './block-cascade';

/**
 * Decide what dragging a programme bar is allowed to do, before anything is
 * written.
 *
 * Three faults lived inside `moveBlock`'s write loop, all of them at a
 * boundary:
 *
 * 1. **A finished bout had its plan rewritten.** The loop moved every bout
 *    behind the bar, whatever state it was in, so a bout already fought — or
 *    being fought right then — got a new planned time. That is history being
 *    edited. The board shows a finished bout where it actually ran, so the plan
 *    and the record stopped agreeing and nothing said which was true. Only a
 *    bout still waiting to be fought moves now, which is the same allowlist the
 *    per-piste "+N" control uses (`shiftLiceRemaining`); both running-late
 *    controls state one rule.
 *
 * 2. **A shift across midnight was half applied.** The bars clamp — `minToTime`
 *    at 23:59 and `cascadeBlockShift` at 00:00 — while the bouts are plain
 *    millisecond arithmetic and roll onto the next day. So a big enough drag
 *    left the bars stacked on the edge of the day and the bouts beyond it,
 *    permanently disagreeing, with nothing on the board to say so. Half a shift
 *    is worse than none, so a shift that cannot be applied whole is refused
 *    whole.
 *
 * 3. **The decision was tangled into the write loop**, so none of it could be
 *    tested without a database. It lives here instead; the service reads either
 *    side of it and writes what comes out.
 *
 * Pure: no I/O and no clock. Times in, times out.
 */

/** Minute-of-day of 00:00 — below it a shift has fallen off the previous day. */
const DAY_FIRST_MIN = 0;

/**
 * Minute-of-day of 23:59.
 *
 * Not an arbitrary edge: it is exactly what `minToTime` clamps to, so a bar
 * asked to land past it is written wrong rather than refused. The refusal below
 * is what stops that write happening at all.
 */
const DAY_LAST_MIN = 23 * 60 + 59;

/** The one bout state a bar move may retime. See fault 1 above. */
const MOVABLE_STATUS = 'scheduled';

/** A same-day programme bar, with the name the refusal will call it by. */
export interface MoveDayBlock extends CascadeBlock {
  label: string;
}

/** A bout the move might retime, as the service reads it. */
export interface MoveCandidateMatch {
  id: string;
  /**
   * `matches.phase_id` is NOT NULL and PostgREST writes a batch as
   * `INSERT … ON CONFLICT DO UPDATE`, where PostgreSQL validates the candidate
   * INSERT row before the conflict resolver fires. So a batched retime has to
   * carry the phase even though it never changes it.
   */
  phaseId: string;
  scheduledAt: string | null;
  status: string;
  /** What the operator calls the bout. Never its id — the refusal is read by a human. */
  label: string | null;
}

/** One bout to retime, ready for the batch write. */
export interface PlannedMatchShift {
  id: string;
  phaseId: string;
  scheduledAt: string;
}

export interface BlockMovePlan {
  /** Empty when the move is refused — a refused move writes nothing at all. */
  matchShifts: PlannedMatchShift[];
  blockShifts: CascadeBlock[];
  /**
   * An English sentence when the move must be refused whole, else null.
   *
   * English on purpose, and reported as-is: the grid's save-error banner shows
   * a server message verbatim (`useScheduleWrites.ts`, which translates only
   * the offline case), the same way `resizeBlock`'s refusal already reaches an
   * organiser. Wording it here keeps one sentence rather than a code the front
   * end has to learn.
   */
  refusal: string | null;
}

/**
 * `YYYY-MM-DD` for the WALL-CLOCK day a Date falls on.
 *
 * Not `toISOString().slice(0, 10)`, which is the UTC day: an event day whose
 * 09:00 local start is stored as 08:00Z is the same date here but would drift
 * across midnight for late-evening bouts in a positive-offset zone. The
 * scheduler places bouts with `setHours` (container-local `TZ`), so every
 * read-back that compares days has to speak the same clock.
 */
export function localDateIso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** `HH:MM` of a Date's wall clock. */
function clockOf(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/**
 * `HH:MM` for a minute-of-day that may sit outside the day.
 *
 * Deliberately NOT `minToTime`: that clamps, and a refusal has to name the time
 * the shift would really have produced. Saying "23:59" about a bar that was
 * heading for 01:00 describes the bug instead of the cause.
 */
function clockOfMin(min: number): string {
  const wrapped = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
}

/** Something the shift would have pushed off the end (or the front) of the day. */
interface Crossing {
  /** How the sentence names it: `the bar "Finals"`, `the fight LSW-F`. */
  what: string;
  from: string;
  to: string;
}

function refusedPlan(movedLabel: string, deltaMin: number, crossing: Crossing): BlockMovePlan {
  const signed = deltaMin > 0 ? `+${deltaMin}` : String(deltaMin);
  return {
    matchShifts: [],
    blockShifts: [],
    refusal:
      `Moving "${movedLabel}" by ${signed} min would carry ${crossing.what} past midnight ` +
      `(${crossing.from} becomes ${crossing.to}). Nothing was moved.`,
  };
}

/**
 * The first bar the shift would push outside the day, in clock order.
 *
 * Clock order, not row order: the database does not promise one, and an
 * operator who moves the same bar twice must be told about the same offender
 * both times.
 */
function firstBarPastMidnight(input: {
  movedBlockId: string;
  deltaMin: number;
  oldStartMin: number;
  dayBlocks: MoveDayBlock[];
}): Crossing | null {
  // A move whose bar is not among the day's rows cascades nothing, which is
  // what `cascadeBlockShift` already decides. Checking the same condition here
  // keeps the two from disagreeing about whether there was a move to refuse.
  if (input.deltaMin === 0) return null;
  if (!input.dayBlocks.some((b) => b.id === input.movedBlockId)) return null;

  for (const bar of [...input.dayBlocks].sort((a, b) => a.startMin - b.startMin)) {
    if (bar.startMin < input.oldStartMin) continue; // earlier bars stay put
    const rawStart = bar.startMin + input.deltaMin;
    const rawEnd = rawStart + (bar.endMin - bar.startMin);
    const named = `the bar "${bar.label}"`;
    if (rawStart < DAY_FIRST_MIN) {
      return { what: named, from: clockOfMin(bar.startMin), to: clockOfMin(rawStart) };
    }
    if (rawEnd > DAY_LAST_MIN) {
      return { what: named, from: clockOfMin(bar.endMin), to: clockOfMin(rawEnd) };
    }
  }
  return null;
}

/**
 * The bouts the shift retimes, or the first one it would push onto another day.
 *
 * The status filter runs BEFORE the crossing check on purpose. A bout that is
 * not moving cannot be carried anywhere, and testing it first would let one
 * finished bout near midnight ground every late-running day.
 */
function planMatchShifts(input: {
  deltaMin: number;
  oldStartMin: number;
  blockDateIso: string;
  matches: MoveCandidateMatch[];
}): { shifts: PlannedMatchShift[]; crossing: Crossing | null } {
  const candidates = input.matches
    .filter((m): m is MoveCandidateMatch & { scheduledAt: string } => Boolean(m.scheduledAt))
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));

  const shifts: PlannedMatchShift[] = [];
  for (const match of candidates) {
    // History, not plan. A bout that has started, finished or been voided keeps
    // the time it was given — see fault 1.
    if (match.status !== MOVABLE_STATUS) continue;
    const at = new Date(match.scheduledAt);
    // Same calendar day as the bar, in WALL-CLOCK terms — the stored instant's
    // local date, not the UTC prefix of its ISO string.
    if (localDateIso(at) !== input.blockDateIso) continue;
    // At or after the bar's old start, read the same way.
    if (at.getHours() * 60 + at.getMinutes() < input.oldStartMin) continue;

    const shifted = new Date(at.getTime() + input.deltaMin * 60_000);
    if (localDateIso(shifted) !== input.blockDateIso) {
      return {
        shifts: [],
        crossing: {
          what: match.label ? `the fight ${match.label}` : 'a fight',
          from: clockOf(at),
          to: clockOf(shifted),
        },
      };
    }
    shifts.push({ id: match.id, phaseId: match.phaseId, scheduledAt: shifted.toISOString() });
  }
  return { shifts, crossing: null };
}

/**
 * Work out which bars and which bouts a bar move retimes, or why it cannot
 * happen.
 *
 * Bars are checked before bouts so the sentence an operator gets names the
 * structure of the day before it names one fight in it.
 */
export function planBlockMove(input: {
  movedBlockId: string;
  movedBlockLabel: string;
  deltaMin: number;
  /** The moved bar's start before the drag; everything at or after it follows. */
  oldStartMin: number;
  /** The wall-clock day the moved bar sits on, as `YYYY-MM-DD`. */
  blockDateIso: string;
  dayBlocks: MoveDayBlock[];
  matches: MoveCandidateMatch[];
}): BlockMovePlan {
  const barCrossing = firstBarPastMidnight(input);
  if (barCrossing) return refusedPlan(input.movedBlockLabel, input.deltaMin, barCrossing);

  const { shifts, crossing } = planMatchShifts(input);
  if (crossing) return refusedPlan(input.movedBlockLabel, input.deltaMin, crossing);

  return {
    matchShifts: shifts,
    // Past the refusals above, no bar can reach either clamp, so this returns
    // the raw shift every time. That is the property they buy.
    blockShifts: cascadeBlockShift(input.dayBlocks, input.movedBlockId, input.deltaMin),
    refusal: null,
  };
}
