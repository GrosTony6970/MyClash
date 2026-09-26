/**
 * The schedule board's LIVE referee check — hard rule 8, recomputed on every card move,
 * by the one checker the server uses (ADR-016).
 *
 * The board holds every bout. `GET /events/:eventId/referee-match-assignments` hands over
 * what it cannot see: every referee duty (a Pool crew is one Pool-scoped row; a bout crew
 * one Match-scoped row per bout), what each duty's organiser already confirmed over, which
 * person each registration belongs to, and the Event's amber switches. This module turns
 * the cards into commitments and asks `checkAssignments`, the same pure function the
 * server's half calls.
 *
 * What only this half can say, and what only the server can. From the cards: a fight is a
 * bout's window, a Pool someone fights in is the hull of its placed bouts, a duty is a
 * Pool's hull or a bout's window — so it reports own_match, fights_overlap,
 * referees_overlap, own_pool, own_pool_span and two_roles as the cards stand now.
 * Teaching, attending, availability, rest and the daily bout cap (ADR-019: day slots and
 * days on the Event clock) need data the board does not hold; the server's
 * half (`useRefereeCrewConflicts`, re-read after each move) reports those. So do a Swiss
 * round's two group rules: the board's bouts carry no round, so here a Swiss bout is judged
 * as a bout on its own (its overlaps still fire). The banner says which half is which.
 *
 * A bout on the Unscheduled panel has no window: it overlaps nothing, so a clash appears
 * the instant a drag creates it and never a moment before. Refereeing one's own bout needs
 * no time and is reported either way. `scheduledAt && liceId` is the board's own test for
 * "on the grid".
 *
 * Labels are the server's shape (`Tournament · Pool`), so a reason the organiser confirmed
 * over on the server is recognised here by its code and label (ruling 135).
 *
 * Pure: no React, no fetch, no i18n. Imported by its own deep path: the scheduling barrel
 * is CommonJS and would drag the auto-assign engine into this page's bundle.
 *
 * ── NEVER A UUID ─────────────────────────────────────────────────────────────
 *
 * A person's name is resolved here — assignment name, then the registration map, then the
 * caller's label — so an organiser never reads a raw id. There is a test that says so.
 */
import {
  ANY_AVAILABILITY,
  FINE,
  checkAssignments,
  markConfirmed,
  mergeVerdicts,
  type RefereeCommitment,
  type RefereeReason,
  type RefereeSwitches,
  type RefereeTarget,
  type RefereeVerdict,
  type StoredRefereeReason,
} from '@myclash/rulesets/scheduling/referee-checker';
import { hullMs, matchWindowMs, type TimeWindowMs } from '@myclash/schedule-core';
import { hhmmInZone } from './conflict-detection';

/** The slice of `ScheduleMatch` this needs. Structural, so the board's rows satisfy it. */
export interface RefereeConflictMatch {
  id: string;
  matchNumberLabel: string;
  roundCode?: string;
  liceId: string | null;
  scheduledAt: string | null;
  durationMinutes: number;
  redRegistrationId: string;
  blueRegistrationId: string;
  poolId: string | null;
  poolName: string | null;
  tournamentName: string | null;
}

/** One referee duty. Mirrors the API payload. */
export interface RefereeConflictAssignment {
  scopeType: 'pool' | 'match';
  matchId: string | null;
  poolId: string | null;
  /** `global_persons.id` — the same space the registrations below are keyed in. */
  personId: string;
  personName: string;
  role: string;
  confirmedReasons: StoredRefereeReason[];
}

/** Which global person a registration belongs to. Mirrors the API payload. */
export interface RefereeConflictRegistration {
  registrationId: string;
  personId: string;
  personName: string;
}

/** One duty the checker has something to say about, as the banner lists it. */
export interface RefereeConflictRow {
  key: string;
  personName: string;
  role: string;
  /** The Pool or bout refereed, as the board names it. */
  refereeingLabel: string;
  /** `HH:MM` on the event's clock, or '' when it has no time. */
  refereeingTime: string;
  level: RefereeVerdict['level'];
  reasons: RefereeReason[];
}

/**
 * The name of the unit a bout belongs to, in the server's shape (`event-commitments.ts`
 * `unitLabel`): the Tournament and the Pool, or the Tournament and the bout's canonical
 * code outside a Pool. A stored reason is matched by it.
 */
function unitLabel(match: RefereeConflictMatch): string {
  const name = match.poolId ? (match.poolName ?? '') : match.roundCode || match.matchNumberLabel;
  return match.tournamentName ? `${match.tournamentName} · ${name}` : name;
}

function windowOf(match: RefereeConflictMatch): TimeWindowMs | null {
  return match.scheduledAt && match.liceId
    ? matchWindowMs(match.scheduledAt, match.durationMinutes)
    : null;
}

interface BoardIndex {
  byId: Map<string, RefereeConflictMatch>;
  boutsOfPool: Map<string, RefereeConflictMatch[]>;
  personOf: Map<string, string>;
}

function indexBoard(
  matches: readonly RefereeConflictMatch[],
  registrations: readonly RefereeConflictRegistration[],
): BoardIndex {
  const boutsOfPool = new Map<string, RefereeConflictMatch[]>();
  for (const m of matches) {
    if (!m.poolId) continue;
    const list = boutsOfPool.get(m.poolId) ?? [];
    list.push(m);
    boutsOfPool.set(m.poolId, list);
  }
  return {
    byId: new Map(matches.map((m) => [m.id, m])),
    boutsOfPool,
    personOf: new Map(registrations.map((r) => [r.registrationId, r.personId])),
  };
}

/** The hull of a Pool's placed bouts: when its crew and its fighters are busy. */
function poolWindow(bouts: readonly RefereeConflictMatch[]): TimeWindowMs | null {
  return hullMs(bouts.map(windowOf).filter((w): w is TimeWindowMs => w !== null));
}

function fightersOf(bout: RefereeConflictMatch, personOf: Map<string, string>): string[] {
  return [bout.redRegistrationId, bout.blueRegistrationId]
    .map((reg) => personOf.get(reg))
    .filter((p): p is string => p !== undefined);
}

/** Fights and fight-pools, from the cards. */
function fightCommitments(
  matches: readonly RefereeConflictMatch[],
  index: BoardIndex,
): RefereeCommitment[] {
  const out: RefereeCommitment[] = [];
  for (const bout of matches) {
    for (const personId of fightersOf(bout, index.personOf)) {
      out.push({
        kind: 'fight',
        personId,
        matchId: bout.id,
        groupId: bout.poolId,
        window: windowOf(bout),
        label: unitLabel(bout),
      });
    }
  }
  for (const [poolId, bouts] of index.boutsOfPool) {
    const people = new Set(bouts.flatMap((b) => fightersOf(b, index.personOf)));
    const window = poolWindow(bouts);
    for (const personId of people) {
      out.push({
        kind: 'fight-pool',
        personId,
        groupId: poolId,
        window,
        label: unitLabel(bouts[0]!),
      });
    }
  }
  return out;
}

/** Where a duty stands, from the cards; null when the board holds none of it. */
function dutyTarget(a: RefereeConflictAssignment, index: BoardIndex): RefereeTarget | null {
  // No day and no day slot: rest and the daily cap (ADR-019) are the server section's,
  // like teaching, attending and availability.
  const base = { role: a.role, tournamentId: '', dayIndex: null, slot: null };
  if (a.scopeType === 'pool' && a.poolId) {
    const bouts = index.boutsOfPool.get(a.poolId);
    if (!bouts) return null;
    return {
      ...base,
      scope: 'pool',
      unitId: a.poolId,
      poolId: a.poolId,
      groupId: a.poolId,
      matchIds: bouts.map((b) => b.id),
      window: poolWindow(bouts),
    };
  }
  const bout = a.matchId ? index.byId.get(a.matchId) : undefined;
  if (!bout) return null;
  return {
    ...base,
    scope: 'match',
    // A per-Pool crew is written one row per bout: its bouts are one unit, the Pool.
    unitId: bout.poolId ?? bout.id,
    poolId: bout.poolId,
    groupId: bout.poolId,
    matchIds: [bout.id],
    window: windowOf(bout),
  };
}

function labelOfTarget(target: RefereeTarget, index: BoardIndex): string {
  const first = index.byId.get(target.matchIds[0] ?? '');
  return first ? unitLabel(first) : '';
}

export function buildRefereeConflictRows(args: {
  matches: RefereeConflictMatch[];
  assignments: RefereeConflictAssignment[];
  registrations: RefereeConflictRegistration[];
  rules: RefereeSwitches;
  /** Event IANA zone — every printed time is read in it. */
  tz: string;
  /** Shown when neither side of the join carries a human name. */
  unknownPersonLabel: string;
}): RefereeConflictRow[] {
  // A person id has to be a real person on BOTH sides: '' would collapse every
  // unidentified referee and fighter onto one key and report a clash between strangers.
  const assignments = args.assignments.filter((a) => a.personId !== '');
  const registrations = args.registrations.filter((r) => r.personId !== '');
  const index = indexBoard(args.matches, registrations);
  const duties = assignments.flatMap((a, i) => {
    const target = dutyTarget(a, index);
    return target ? [{ id: i, assignment: a, target }] : [];
  });
  if (duties.length === 0) return [];

  const dutyCommitments: RefereeCommitment[] = duties.map(({ assignment, target }) => ({
    kind: 'referee',
    personId: assignment.personId,
    unitId: target.unitId,
    poolId: target.poolId,
    matchId: assignment.scopeType === 'match' ? assignment.matchId : null,
    role: assignment.role,
    matchIds: target.matchIds,
    slot: null,
    dayIndex: null,
    window: target.window,
    label: labelOfTarget(target, index),
  }));
  const verdicts = checkAssignments(
    duties.map(({ id, assignment, target }) => ({ id, personId: assignment.personId, target })),
    [...fightCommitments(args.matches, index), ...dutyCommitments],
    () => ANY_AVAILABILITY,
    args.rules,
  );
  return rowsOf(duties, verdicts, index, args, registrations);
}

/** One row per person, unit and role, with every reason once; silent duties left out. */
function rowsOf(
  duties: ReadonlyArray<{
    id: number;
    assignment: RefereeConflictAssignment;
    target: RefereeTarget;
  }>,
  verdicts: Map<number, RefereeVerdict>,
  index: BoardIndex,
  args: { tz: string; unknownPersonLabel: string },
  registrations: readonly RefereeConflictRegistration[],
): RefereeConflictRow[] {
  const names = nameIndex(registrations);
  const rows = new Map<string, RefereeConflictRow>();
  for (const { id, assignment, target } of duties) {
    const verdict = markConfirmed(verdicts.get(id)!, assignment.confirmedReasons);
    if (verdict.reasons.length === 0) continue;
    const key = `${target.unitId}:${assignment.personId}:${assignment.role}`;
    const seen = rows.get(key);
    // The target's start (a Pool's hull starts at its earliest placed bout), as the server's.
    const start = target.window ? new Date(target.window.startMs).toISOString() : null;
    rows.set(key, {
      key,
      personName:
        assignment.personName.trim() || names.get(assignment.personId) || args.unknownPersonLabel,
      role: assignment.role,
      refereeingLabel: seen?.refereeingLabel ?? labelOfTarget(target, index),
      refereeingTime: seen?.refereeingTime ?? (start ? hhmmInZone(start, args.tz) : ''),
      ...mergeVerdicts(seen ?? FINE, verdict),
    });
  }
  return [...rows.values()];
}

/** First non-empty name per person, so a blank registration row cannot mask a populated one. */
function nameIndex(registrations: readonly RefereeConflictRegistration[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const r of registrations) {
    const name = r.personName.trim();
    if (name && !index.has(r.personId)) index.set(r.personId, name);
  }
  return index;
}
