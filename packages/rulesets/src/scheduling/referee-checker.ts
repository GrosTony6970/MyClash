/**
 * referee-checker.ts — the one answer to "may this person referee this unit?" (ADR-016).
 *
 * Every door that assigns a referee, and every screen that shows a clash, asks this
 * function. It used to be decided in five places that disagreed: a referee booked in
 * another hall at the same time was greyed out in the picker and accepted by Assign.
 *
 * Two levels:
 *   - Impossible: no switch, no override. Refereeing one's own Match; fighting,
 *     refereeing elsewhere (any hall) or teaching a Workshop at an overlapping time;
 *     outside one's declared availability.
 *   - Discouraged: each rule has one per-Event switch; the organiser may go ahead
 *     after confirming. One's own Pool at another time; two roles on one unit;
 *     attending a Workshop at an overlapping time; refereeing while a Pool one fights
 *     in is running, outside one's own bouts (operator ruling 5).
 * The verdict is the worst level; every reason that applies is returned.
 *
 * Commitments arrive already windowed (ADR-017: a Match is `[start, start + length)`,
 * a Pool is the hull of its Matches). A target or commitment with no window overlaps
 * nothing. Overlap is `overlapsHalfOpen`, the one owner: touching is not overlapping.
 *
 * Pure: no I/O, no clock, no i18n. Screens word a reason by its code
 * (`REFEREE_REASON_CODES`); what is stored when an organiser confirms is the code and
 * the DATA name it was against (a Pool name, a round code, a Workshop title), never an
 * id and never a sentence.
 *
 * Imported by its own deep path: the scheduling barrel is CommonJS and would drag the
 * assignment engine into the admin board's bundle.
 */
import { overlapsHalfOpen, type TimeWindowMs } from '@myclash/schedule-core';

export const REFEREE_REASON_CODES = [
  'own_match',
  'fights_overlap',
  'referees_overlap',
  'teaches_overlap',
  'outside_availability',
  'own_pool',
  'own_pool_span',
  'two_roles',
  'attends_overlap',
] as const;

export type RefereeReasonCode = (typeof REFEREE_REASON_CODES)[number];
export type RefereeLevel = 'impossible' | 'discouraged';

const IMPOSSIBLE: ReadonlySet<RefereeReasonCode> = new Set<RefereeReasonCode>([
  'own_match',
  'fights_overlap',
  'referees_overlap',
  'teaches_overlap',
  'outside_availability',
]);

export function levelOf(code: RefereeReasonCode): RefereeLevel {
  return IMPOSSIBLE.has(code) ? 'impossible' : 'discouraged';
}

interface CommitmentBase {
  /** `global_persons.id`. */
  personId: string;
  window: TimeWindowMs | null;
  /** The data name a screen shows and a confirm stores. */
  label: string;
}

/**
 * Something a person is doing. A fight is one bout; a fight-pool is the whole group a
 * person fights in — a Pool, or a Swiss round across its pistes — as its hull, and it
 * carries the two Pool rules; a referee duty sits on a board unit (a Pool, a Swiss round
 * on one piste, a bracket bout).
 *
 * A fight's `groupId` is the group whose span the bout is part of (the Pool, or the Swiss
 * round). A bout of that group on another piste at the same time is still two places at
 * once: the group decides the two Pool rules, never whether an overlap counts.
 */
export type RefereeCommitment =
  | (CommitmentBase & {
      kind: 'fight';
      matchId: string;
      groupId: string | null;
    })
  | (CommitmentBase & { kind: 'fight-pool'; groupId: string })
  | (CommitmentBase & {
      kind: 'referee';
      unitId: string;
      poolId: string | null;
      matchId: string | null;
      role: string;
    })
  | (CommitmentBase & { kind: 'teach' | 'attend'; sessionId: string });

/** What someone would referee. */
export interface RefereeTarget {
  /** 'pool': one Pool-scoped duty over the whole Pool. 'match': duties on these bouts. */
  scope: 'pool' | 'match';
  /** The board unit. Duties on the same unit are "on" the target (two roles, not two places). */
  unitId: string;
  /** The real Pool the unit or bout belongs to, when there is one. */
  poolId: string | null;
  /** The group whose fighters make this "their own" (a Pool, a Swiss round); null for a bracket bout. */
  groupId: string | null;
  matchIds: readonly string[];
  window: TimeWindowMs | null;
  role: string;
  tournamentId: string;
  /** The target's day on the Event clock, or null when it has no time. */
  dayIndex: number | null;
}

/** Declared availability; null = no restriction on that axis. */
export interface RefereeAvailability {
  tournamentIds: readonly string[] | null;
  dayIndices: readonly number[] | null;
}

export const ANY_AVAILABILITY: RefereeAvailability = { tournamentIds: null, dayIndices: null };

/** The Discouraged rules' per-Event switches. The Impossible rules have none. */
export interface RefereeSwitches {
  ownPool: boolean;
  ownPoolSpan: boolean;
  twoRoles: boolean;
  attendWorkshop: boolean;
}

export interface RefereeReason {
  code: RefereeReasonCode;
  level: RefereeLevel;
  /** What it clashes with. Null for availability. */
  against: { kind: 'match' | 'pool' | 'unit' | 'workshop'; id: string; label: string } | null;
  /** True when the organiser already confirmed over this reason (ruling 135). */
  confirmed: boolean;
}

export interface RefereeVerdict {
  level: RefereeLevel | 'fine';
  reasons: RefereeReason[];
}

/** What a confirm stores in `referee_assignments.conflicts_jsonb`. */
export interface StoredRefereeReason {
  code: RefereeReasonCode;
  label: string;
}

type Fight = Extract<RefereeCommitment, { kind: 'fight' }>;
type FightPool = Extract<RefereeCommitment, { kind: 'fight-pool' }>;
type Duty = Extract<RefereeCommitment, { kind: 'referee' }>;

function reason(code: RefereeReasonCode, against: RefereeReason['against']): RefereeReason {
  return { code, level: levelOf(code), against, confirmed: false };
}

function overlaps(a: TimeWindowMs | null, b: TimeWindowMs | null): boolean {
  return a !== null && b !== null && overlapsHalfOpen(a, b);
}

function fightReasons(
  target: RefereeTarget,
  fights: readonly Fight[],
  pools: readonly FightPool[],
  switches: RefereeSwitches,
): RefereeReason[] {
  const out: RefereeReason[] = [];
  const onTarget = new Set(target.matchIds);
  const ownBouts = target.scope === 'match' ? fights.filter((f) => onTarget.has(f.matchId)) : [];
  for (const f of ownBouts)
    out.push(reason('own_match', { kind: 'match', id: f.matchId, label: f.label }));

  // A bout ON the target is own_match's, or — for a Pool crew, whose target is all its
  // bouts — own_pool's. Any other bout at an overlapping time is two places at once,
  // a bout of the same Pool dragged to another piste included (hard rule 8).
  const clashing = fights.filter(
    (f) => !onTarget.has(f.matchId) && overlaps(f.window, target.window),
  );
  for (const f of clashing) {
    out.push(reason('fights_overlap', { kind: 'match', id: f.matchId, label: f.label }));
  }

  if (switches.ownPool && ownBouts.length === 0 && target.groupId !== null) {
    const own = pools.find((p) => p.groupId === target.groupId);
    if (own) out.push(reason('own_pool', { kind: 'pool', id: own.groupId, label: own.label }));
  }

  // A group one of whose bouts already clashes is told by that bout (Impossible).
  if (switches.ownPoolSpan) {
    const groupsWithClashingBout = new Set(clashing.map((f) => f.groupId));
    for (const p of pools) {
      if (p.groupId === target.groupId || groupsWithClashingBout.has(p.groupId)) continue;
      if (overlaps(p.window, target.window)) {
        out.push(reason('own_pool_span', { kind: 'pool', id: p.groupId, label: p.label }));
      }
    }
  }
  return out;
}

/** A duty on the target itself: same unit, same Pool, or one of its bouts. */
function isOnTarget(duty: Duty, target: RefereeTarget): boolean {
  return (
    duty.unitId === target.unitId ||
    (target.poolId !== null && duty.poolId === target.poolId) ||
    (duty.matchId !== null && target.matchIds.includes(duty.matchId))
  );
}

function dutyReasons(
  target: RefereeTarget,
  duties: readonly Duty[],
  switches: RefereeSwitches,
): RefereeReason[] {
  const out: RefereeReason[] = [];
  for (const d of duties) {
    const against = { kind: 'unit' as const, id: d.unitId, label: d.label };
    if (isOnTarget(d, target)) {
      if (switches.twoRoles && d.role !== target.role) out.push(reason('two_roles', against));
    } else if (overlaps(d.window, target.window)) {
      out.push(reason('referees_overlap', against));
    }
  }
  return out;
}

function workshopReasons(
  target: RefereeTarget,
  mine: readonly RefereeCommitment[],
  switches: RefereeSwitches,
): RefereeReason[] {
  const out: RefereeReason[] = [];
  for (const c of mine) {
    if ((c.kind !== 'teach' && c.kind !== 'attend') || !overlaps(c.window, target.window)) continue;
    if (c.kind === 'attend' && !switches.attendWorkshop) continue;
    const against = { kind: 'workshop' as const, id: c.sessionId, label: c.label };
    out.push(reason(c.kind === 'teach' ? 'teaches_overlap' : 'attends_overlap', against));
  }
  return out;
}

function availabilityReasons(
  target: RefereeTarget,
  availability: RefereeAvailability,
): RefereeReason[] {
  const tournamentOut =
    availability.tournamentIds !== null &&
    !availability.tournamentIds.includes(target.tournamentId);
  const dayOut =
    availability.dayIndices !== null &&
    target.dayIndex !== null &&
    !availability.dayIndices.includes(target.dayIndex);
  return tournamentOut || dayOut ? [reason('outside_availability', null)] : [];
}

const reasonKey = (r: RefereeReason) => `${r.code}:${r.against?.kind ?? ''}:${r.against?.id ?? ''}`;

/** One reason per (code, thing it clashes with): a Swiss crew holds one row per bout. */
function dedupe(reasons: readonly RefereeReason[]): RefereeReason[] {
  const seen = new Set<string>();
  return reasons.filter((r) => {
    const key = reasonKey(r);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export const FINE: RefereeVerdict = { level: 'fine', reasons: [] };

/**
 * Two verdicts on one crew as one — a person refereeing several bouts of one Pool:
 * every reason once (confirmed when either said so), the worst level.
 */
export function mergeVerdicts(a: RefereeVerdict, b: RefereeVerdict): RefereeVerdict {
  const byKey = new Map<string, RefereeReason>();
  for (const r of [...a.reasons, ...b.reasons]) {
    const seen = byKey.get(reasonKey(r));
    byKey.set(reasonKey(r), seen ? { ...seen, confirmed: seen.confirmed || r.confirmed } : r);
  }
  return verdictOf([...byKey.values()]);
}

function verdictOf(reasons: readonly RefereeReason[]): RefereeVerdict {
  const level = reasons.some((r) => r.level === 'impossible')
    ? 'impossible'
    : reasons.some((r) => r.level === 'discouraged' && !r.confirmed)
      ? 'discouraged'
      : 'fine';
  return { level, reasons: [...reasons] };
}

export function checkReferee(args: {
  personId: string;
  target: RefereeTarget;
  commitments: readonly RefereeCommitment[];
  availability: RefereeAvailability;
  switches: RefereeSwitches;
}): RefereeVerdict {
  const { personId, target, availability, switches } = args;
  const mine = args.commitments.filter((c) => c.personId === personId);
  const fights = mine.filter((c): c is Fight => c.kind === 'fight');
  const pools = mine.filter((c): c is FightPool => c.kind === 'fight-pool');
  const duties = mine.filter((c): c is Duty => c.kind === 'referee');
  return verdictOf(
    dedupe([
      ...fightReasons(target, fights, pools, switches),
      ...dutyReasons(target, duties, switches),
      ...workshopReasons(target, mine, switches),
      ...availabilityReasons(target, availability),
    ]),
  );
}

/**
 * Re-judge assignments that already exist, each without its own duty — that is how a
 * later schedule move shows red or amber (ADR-016 "later changes"). The own duty is
 * every duty of the same person, unit and role: a Swiss crew is one row per bout.
 */
export function checkAssignments<Id>(
  assignments: readonly { id: Id; personId: string; target: RefereeTarget }[],
  commitments: readonly RefereeCommitment[],
  availabilityOf: (personId: string) => RefereeAvailability,
  switches: RefereeSwitches,
): Map<Id, RefereeVerdict> {
  const out = new Map<Id, RefereeVerdict>();
  for (const a of assignments) {
    const others = commitments.filter(
      (c) =>
        !(
          c.kind === 'referee' &&
          c.personId === a.personId &&
          c.unitId === a.target.unitId &&
          c.role === a.target.role
        ),
    );
    out.set(
      a.id,
      checkReferee({
        personId: a.personId,
        target: a.target,
        commitments: others,
        availability: availabilityOf(a.personId),
        switches,
      }),
    );
  }
  return out;
}

/**
 * Mark the Discouraged reasons the organiser already confirmed over (ruling 135): they
 * stay listed, and no longer make the verdict a warning. A reason is the same one when
 * its code and the name it was against match. Impossible is never confirmed.
 */
export function markConfirmed(
  verdict: RefereeVerdict,
  stored: readonly StoredRefereeReason[],
): RefereeVerdict {
  const reasons = verdict.reasons.map((r) => ({
    ...r,
    confirmed:
      r.level === 'discouraged' &&
      stored.some((s) => s.code === r.code && s.label === (r.against?.label ?? '')),
  }));
  return verdictOf(reasons);
}

/** What a confirm stores: the Discouraged reasons, by code and data name. */
export function toStoredReasons(verdict: RefereeVerdict): StoredRefereeReason[] {
  return verdict.reasons
    .filter((r) => r.level === 'discouraged')
    .map((r) => ({ code: r.code, label: r.against?.label ?? '' }));
}

/** Reads `conflicts_jsonb` back; anything that is not a stored reason is dropped. */
export function parseStoredReasons(value: unknown): StoredRefereeReason[] {
  if (!Array.isArray(value)) return [];
  const codes: ReadonlySet<string> = new Set(REFEREE_REASON_CODES);
  return value.flatMap((item) => {
    if (typeof item !== 'object' || item === null) return [];
    const { code, label } = item as { code?: unknown; label?: unknown };
    return typeof code === 'string' && codes.has(code) && typeof label === 'string'
      ? [{ code: code as RefereeReasonCode, label }]
      : [];
  });
}
