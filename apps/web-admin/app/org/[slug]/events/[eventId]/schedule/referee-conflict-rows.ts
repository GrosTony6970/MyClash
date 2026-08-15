/**
 * Per-match referee conflicts for the schedule board, recomputed on every card
 * move — the live half of hard rule 8 (`enforce_fighter_referee_no_overlap`).
 *
 * The board already re-derives FIGHTER double-bookings on each render (see
 * ./conflict-detection). It could not do the same for referees because it holds
 * no idea who is refereeing what, nor which person a registration belongs to.
 * `GET /events/:eventId/referee-match-assignments` hands over exactly those two
 * things, and this module joins them to the bouts the board is already holding.
 *
 * Pure: no React, no fetch, no i18n. The two human strings it needs are
 * arguments, so the i18n lint rule never has to reach in here.
 *
 * ── WHY THE DEEP IMPORT ──────────────────────────────────────────────────────
 *
 * `@myclash/rulesets/scheduling` is a CommonJS barrel with no tree-shaking, so
 * importing the detector through it drags snake-seeding, local search, Berger,
 * both bracket generators, Swiss and the referee assigner into this page's
 * client bundle: 30 KB gzip to reach a 1.4 KB function. The package therefore
 * exposes `conflict-check` as its own export, and that is the one to use.
 *
 * ── WHAT COUNTS AS A CONFLICT HERE ───────────────────────────────────────────
 *
 * Two rules, and they answer different questions:
 *
 *   `own_bout`   — the person is committed to referee the very bout they fight
 *                  in. Time does not enter into it, so an unplaced bout counts
 *                  just the same. Both detectors in the codebase skip this case
 *                  on purpose, each deferring to the pool-scoped "cannot
 *                  referee your own pool" rule, which is scoped to pools and is
 *                  disableable. A match-scoped commitment falls between the
 *                  two, so it is caught here.
 *
 *   `overlap`    — the person fights in one bout and referees another whose
 *                  time window runs into it. CONFIRMED overlaps only: both
 *                  bouts must carry a time and a piste.
 *
 * The detector reports a clash as merely "potential" whenever either side is
 * unplaced. That is deliberately not surfaced. The board holds every bout in
 * the event, the Unscheduled panel included, so a potential row would fire for
 * every referee who also fights and still has anything unplaced — on a fresh
 * board, very nearly all of them. Feeding the detector only placed bouts means
 * `windowsOverlap` can never return `potential_overlap`, so the row appears the
 * instant a drag creates a real clash and never a moment before. `scheduledAt
 * && liceId` is the same predicate the board itself uses to decide what is on
 * the grid rather than in the panel.
 *
 * ── NEVER A UUID ─────────────────────────────────────────────────────────────
 *
 * The detector's last-resort name is the person id. That is a raw UUID in front
 * of an organiser, so the name is resolved here first — assignment name, then
 * the registration map, then the caller's label — and the detector's fallback
 * becomes unreachable. There is a test that says so.
 */
import { detectFighterRefereeConflicts } from '@myclash/rulesets/scheduling/conflict-check';
import { hhmmInZone } from './conflict-detection';

/** The slice of `ScheduleMatch` this needs. Structural, so the board's own
 *  rows satisfy it without a conversion step. */
export interface RefereeConflictMatch {
  id: string;
  matchNumberLabel: string;
  roundCode?: string;
  liceId: string | null;
  scheduledAt: string | null;
  durationMinutes: number;
  redRegistrationId: string;
  blueRegistrationId: string;
}

/** One referee committed to one bout. Mirrors the API payload. */
export interface RefereeConflictAssignment {
  matchId: string;
  /** `global_persons.id` — the same space the registrations below are keyed in. */
  personId: string;
  personName: string;
  role: string;
}

/** Which global person a registration belongs to. Mirrors the API payload. */
export interface RefereeConflictRegistration {
  registrationId: string;
  personId: string;
  personName: string;
}

export type RefereeConflictKind = 'own_bout' | 'overlap';

export interface RefereeConflictRow {
  kind: RefereeConflictKind;
  personName: string;
  /** The bout they fight in. Identical to the refereeing bout for `own_bout`. */
  fightingMatchId: string;
  fightingLabel: string;
  /** `HH:MM` on the event's clock, or '' when the bout carries no time. */
  fightingTime: string;
  refereeingMatchId: string;
  refereeingLabel: string;
  refereeingTime: string;
  refereeRole: string;
}

/** The board shows the canonical code when it has one. */
function labelOf(match: RefereeConflictMatch): string {
  return match.roundCode || match.matchNumberLabel;
}

function timeOf(match: RefereeConflictMatch, tz: string): string {
  return match.scheduledAt ? hhmmInZone(match.scheduledAt, tz) : '';
}

/** On the grid rather than in the Unscheduled panel — the board's own test. */
function isPlaced(match: RefereeConflictMatch): boolean {
  return Boolean(match.scheduledAt && match.liceId);
}

export function buildRefereeConflictRows(args: {
  matches: RefereeConflictMatch[];
  assignments: RefereeConflictAssignment[];
  registrations: RefereeConflictRegistration[];
  /** Event IANA zone — every printed time is read in it. */
  tz: string;
  /** Shown when neither side of the join carries a human name. */
  unknownPersonLabel: string;
}): RefereeConflictRow[] {
  const { matches, tz, unknownPersonLabel } = args;
  const matchById = new Map(matches.map((m) => [m.id, m]));
  // A person id has to be a real person on BOTH sides. The API drops rows it
  // cannot resolve rather than emitting them under '', because the detector
  // keys its lookup by person and '' would collapse every unidentified referee
  // and every unidentified fighter onto one key — reporting a clash between two
  // strangers, on the one banner an organiser has to be able to trust. That was
  // a live defect in the API's own conflict check. Repeated here because the
  // board is a second consumer, and a rule pinned in one place is a rule that
  // travels only as far as that place.
  const assignments = args.assignments.filter((a) => a.personId !== '');
  const registrations = args.registrations.filter((r) => r.personId !== '');
  // An assignment whose bout the board is not holding has no label and no time,
  // so there is nothing truthful to put in a row about it.
  const onBoard = assignments.filter((a) => matchById.has(a.matchId));
  if (onBoard.length === 0) return [];

  const nameByPerson = nameIndex(registrations);
  const named = onBoard.map((a) => ({
    ...a,
    personName: a.personName.trim() || nameByPerson.get(a.personId) || unknownPersonLabel,
  }));

  // Own-bout first: it is the worse violation, and it does not depend on time.
  return [
    ...ownBoutRows(named, matchById, registrations, tz),
    ...overlapRows(named, matches, registrations, tz),
  ];
}

/** First non-empty name per person, so a blank registration row cannot mask a
 *  populated one. */
function nameIndex(registrations: readonly RefereeConflictRegistration[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const r of registrations) {
    const name = r.personName.trim();
    if (name && !index.has(r.personId)) index.set(r.personId, name);
  }
  return index;
}

/** Person id per registration id, for "is this referee one of the two fighters
 *  in this very bout". */
function personByRegistration(
  registrations: readonly RefereeConflictRegistration[],
): Map<string, string> {
  return new Map(registrations.map((r) => [r.registrationId, r.personId]));
}

function ownBoutRows(
  assignments: readonly RefereeConflictAssignment[],
  matchById: ReadonlyMap<string, RefereeConflictMatch>,
  registrations: readonly RefereeConflictRegistration[],
  tz: string,
): RefereeConflictRow[] {
  const personOf = personByRegistration(registrations);
  const rows: RefereeConflictRow[] = [];
  // A crew can hold two roles on one bout, which is two assignment rows. The
  // finding is "you are refereeing your own fight" either way, so it is said
  // once — the same dedup the detector applies to its own pairs.
  const seen = new Set<string>();
  for (const a of assignments) {
    const match = matchById.get(a.matchId);
    if (!match) continue;
    const fighters = [
      personOf.get(match.redRegistrationId),
      personOf.get(match.blueRegistrationId),
    ];
    if (!fighters.includes(a.personId)) continue;
    const key = `${a.personId}:${a.matchId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const label = labelOf(match);
    const time = timeOf(match, tz);
    rows.push({
      kind: 'own_bout',
      personName: a.personName,
      fightingMatchId: match.id,
      fightingLabel: label,
      fightingTime: time,
      refereeingMatchId: match.id,
      refereeingLabel: label,
      refereeingTime: time,
      refereeRole: a.role,
    });
  }
  return rows;
}

/** The detector's first argument: the bouts, with the board's display label. */
function toDetectorMatches(placed: readonly RefereeConflictMatch[]) {
  return placed.map((m) => ({
    id: m.id,
    label: labelOf(m),
    redRegistrationId: m.redRegistrationId,
    blueRegistrationId: m.blueRegistrationId,
    scheduledAt: m.scheduledAt,
    durationMinutes: m.durationMinutes,
  }));
}

/** The detector's second argument. A referee commitment carries no time of its
 *  own — it borrows the bout's, which is why this needs the match index. */
function toDetectorAssignments(
  assignments: readonly RefereeConflictAssignment[],
  matchById: ReadonlyMap<string, RefereeConflictMatch>,
) {
  return assignments.flatMap((a) => {
    const match = matchById.get(a.matchId);
    if (!match) return [];
    return [
      {
        matchId: a.matchId,
        matchLabel: labelOf(match),
        personId: a.personId,
        // Already resolved by the caller, which is what makes the detector's
        // own person-id fallback unreachable.
        personName: a.personName,
        role: a.role,
        scheduledAt: match.scheduledAt,
        durationMinutes: match.durationMinutes,
      },
    ];
  });
}

/**
 * The detector's third argument, narrowed to the people who actually referee.
 *
 * It reads the map only by an assignment's person id — to find that person's
 * bouts, and for its own name fallback. Registrations belonging to nobody who
 * referees are therefore pure work: it rebuilds a filter over every bout for
 * each one, so an event with 500 registrations and 2000 bouts costs a million
 * comparisons on every card move. Dropping them cannot change the answer.
 */
function toDetectorRegistrations(
  registrations: readonly RefereeConflictRegistration[],
  refereePersons: ReadonlySet<string>,
) {
  return registrations
    .filter((r) => refereePersons.has(r.personId))
    .map((r) => ({
      registrationId: r.registrationId,
      personId: r.personId,
      personName: r.personName,
    }));
}

function overlapRows(
  assignments: readonly RefereeConflictAssignment[],
  matches: readonly RefereeConflictMatch[],
  registrations: readonly RefereeConflictRegistration[],
  tz: string,
): RefereeConflictRow[] {
  const placed = matches.filter(isPlaced);
  const placedById = new Map(placed.map((m) => [m.id, m]));
  const placedAssignments = assignments.filter((a) => placedById.has(a.matchId));
  if (placedAssignments.length === 0) return [];
  const refereePersons = new Set(placedAssignments.map((a) => a.personId));

  const { conflicts } = detectFighterRefereeConflicts(
    toDetectorMatches(placed),
    toDetectorAssignments(placedAssignments, placedById),
    toDetectorRegistrations(registrations, refereePersons),
  );

  return conflicts.map((c) => ({
    kind: 'overlap' as const,
    personName: c.personName,
    fightingMatchId: c.fightingMatchId,
    fightingLabel: c.fightingMatchLabel,
    fightingTime: c.fightingScheduledAt ? hhmmInZone(c.fightingScheduledAt, tz) : '',
    refereeingMatchId: c.refereeingMatchId,
    refereeingLabel: c.refereeingMatchLabel,
    refereeingTime: c.refereeingScheduledAt ? hhmmInZone(c.refereeingScheduledAt, tz) : '',
    refereeRole: c.refereeRole,
  }));
}
