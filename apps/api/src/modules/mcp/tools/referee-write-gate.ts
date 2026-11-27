/**
 * referee-write-gate.ts — what the two referee write tools ask before they change anything
 * (slice 4a): `preview_referee_assignment` and `apply_referee_assignment` share it, so each
 * rule has one owner.
 *
 * Each refusal is one sentence for `answer()`. Only the exception a rule throws to refuse is a
 * refusal; any other throw (a failed read) is the generic failure.
 */
import { createTranslator, messages } from '@myclash/i18n';
import type { RefereeReason } from '@myclash/rulesets/scheduling/referee-checker';
import {
  refereeReasonText,
  refereeReasonsText,
} from '@myclash/rulesets/scheduling/referee-reason-text';
import { ForbiddenException } from '@nestjs/common';
import { assertCanManageEvent } from '../../../common/auth/event-authz';
import { isOver } from '../../../common/live-status';
import { OperationalUnavailableException } from '../../../common/operational-exception';
import { assertNotReadOnly } from '../../../common/read-only-mode';
import { ACTIVE_STATUSES, toAssignmentRow } from '../../matches/referee-assignment-index';
import {
  winningAssignmentRows,
  type MatchRefereeTarget,
} from '../../matches/resolve-match-referees';
import { ROUND_CODE_INPUTS, roundCodeFromMatchRow } from '../../matches/round-code.helper';
import type { RefereeSkill } from '../../referees/event-skills';
import { isRefereeBoardLocked } from '../../referees/referee-lock';
import type { McpCaller, McpToolDeps } from '../mcp-server';
import type { McpRefusal } from './mcp-answer';

export const MAINTENANCE_REFUSAL: McpRefusal = {
  refusal: 'MyClash is in maintenance: nothing can change right now.',
};

/**
 * The door passes read-only mode (ruling 985), so a write tool asks it itself. The one
 * exception `assertNotReadOnly` refuses with is the maintenance refusal; anything else throws.
 */
export async function maintenanceRefusal(deps: McpToolDeps): Promise<McpRefusal | null> {
  try {
    await assertNotReadOnly(deps.supabase);
    return null;
  } catch (refused) {
    if (refused instanceof OperationalUnavailableException) return MAINTENANCE_REFUSAL;
    throw refused;
  }
}

/** The Event as the gate reads it: `status` from the `events` row. */
export interface GateEvent {
  id: string;
  name: string;
  status: string;
}

/**
 * Maintenance, the organiser bar (editor or above, as `PUT matches/:id/referee-role-assignments`,
 * call J), an Event that is over (call K), and the referee board's lock, in that order.
 */
export async function refereeWriteRefusal(
  event: GateEvent,
  caller: McpCaller,
  deps: McpToolDeps,
): Promise<McpRefusal | null> {
  const maintenance = await maintenanceRefusal(deps);
  if (maintenance) return maintenance;
  try {
    await assertCanManageEvent(deps, event.id, caller.userId);
  } catch (refused) {
    if (!(refused instanceof ForbiddenException)) throw refused;
    return { refusal: "Only the Event's organisers (editor or above) can change its referees." };
  }
  if (isOver(event.status)) {
    return { refusal: `${event.name} is over: its referees can no longer change.` };
  }
  if (await isRefereeBoardLocked(deps.supabase.service, event.id)) return LOCKED_REFUSAL;
  return null;
}

/** The referee board's lock, asked here and again inside the write (`referee_board_locked`). */
export const LOCKED_REFUSAL: McpRefusal = {
  refusal: 'Referee assignments are locked at this Event. Unlock them in MyClash first.',
};

/** A `matches` select that names the bout (its round code), its piste, start, Pool and Lice. */
export const MATCH_SELECT = `id, match_number_label, scheduled_at, pool_id, lice_id, lices(name), ${ROUND_CODE_INPUTS}`;

/** One bout as the referee tools see it. Its ids stay inside the tool. */
export interface WriteMatch {
  seat: MatchRefereeTarget;
  code: string;
  start: string | null;
  piste: string | null;
  /** The Pool's number as its code shows it (`P2` → 2); null outside a Pool. */
  poolNumber: number | null;
}

export function toWriteMatch(row: Record<string, unknown>): WriteMatch {
  const pool = row['pools'] as { sort_order?: number } | null;
  const lice = row['lices'] as { name?: string } | null;
  return {
    seat: {
      matchId: row['id'] as string,
      poolId: (row['pool_id'] as string | null) ?? null,
      liceId: (row['lice_id'] as string | null) ?? null,
    },
    code: roundCodeFromMatchRow(row),
    start: (row['scheduled_at'] as string | null) ?? null,
    piste: lice?.name ?? null,
    poolNumber: typeof pool?.sort_order === 'number' ? pool.sort_order + 1 : null,
  };
}

/** One active assignment that may referee the bout: its own, its Pool's or its Lice's. */
export interface CrewRow {
  scopeType: string;
  matchId: string | null;
  poolId: string | null;
  liceId: string | null;
  role: string | null;
  personId: string | null;
  name: string;
}

/**
 * The bout's crew rows, every role, every tier (match, Pool, Lice). It THROWS on a read error:
 * `fetchRefereeAssignmentIndex` answers `[]` on one, which here would read as "nobody holds the
 * role" and pass the holder check (call H).
 */
export async function readCrewRows(
  deps: McpToolDeps,
  eventId: string,
  seat: MatchRefereeTarget,
): Promise<CrewRow[]> {
  const scopes = [
    `match_id.eq.${seat.matchId}`,
    ...(seat.poolId ? [`pool_id.eq.${seat.poolId}`] : []),
    ...(seat.liceId ? [`lice_id.eq.${seat.liceId}`] : []),
  ].join(',');
  const { data, error } = await deps.supabase.service
    .from('referee_assignments')
    .select(
      'person_id, role, scope_type, match_id, pool_id, lice_id, global_persons(given_name, family_name)',
    )
    .eq('event_id', eventId)
    .in('status', [...ACTIVE_STATUSES])
    .or(scopes);
  if (error) throw new Error(`referee crew read failed: ${error.message}`);
  type Raw = Parameters<typeof toAssignmentRow>[0];
  return ((data ?? []) as unknown as Raw[]).map((raw) => {
    // The index's reader owns the name (given + family, the embed's two shapes).
    const { scopeType, matchId, poolId, liceId, role, name } = toAssignmentRow(raw);
    return { scopeType, matchId, poolId, liceId, role, name, personId: raw.person_id };
  });
}

/**
 * Who holds `role` on the bout: the winning tier's row for it (match > Pool > Lice, the whole
 * tier across roles, as the crew screens resolve it), or null. Two rows of one role in a tier
 * take the lowest person id, so preview and apply name the same holder.
 */
export function holderOf(
  rows: readonly CrewRow[],
  seat: MatchRefereeTarget,
  role: string,
): CrewRow | null {
  const holders = winningAssignmentRows(rows, seat)
    .filter((r) => r.role === role && r.personId !== null)
    .sort((a, b) => (a.personId! < b.personId! ? -1 : 1));
  return holders[0] ?? null;
}

/** A referee the tools name: the roster's person id and display name. */
export interface WritePerson {
  personId: string;
  displayName: string;
}

/** A referee as the Event's roster lists them (`listEventReferees`), with their skills. */
export interface RosterReferee extends WritePerson {
  qualifications: readonly { skillId: string }[];
}

/**
 * A referee without the role's skill refuses by name (call Q): at the preview, and again at
 * the apply, where the skill may have gone since. The checker would throw a 400 for it.
 */
export function missingSkillRefusal(
  person: RosterReferee,
  skill: RefereeSkill,
  event: { name: string },
): McpRefusal | null {
  if (person.qualifications.some((q) => q.skillId === skill.id)) return null;
  return {
    refusal: `${person.displayName} does not hold the ${skill.name} skill at ${event.name}.`,
  };
}

/**
 * The crew rows once the write lands (call M2): `replace_match_referee_role` replaces the
 * Match's own rows of the role by the new person's, or by none for a removal.
 */
export function rowsAfterWrite(
  rows: readonly CrewRow[],
  seat: MatchRefereeTarget,
  role: string,
  person: WritePerson | null,
): CrewRow[] {
  const kept = rows.filter(
    (r) => !(r.scopeType === 'match' && r.matchId === seat.matchId && r.role === role),
  );
  if (!person) return kept;
  const written: CrewRow = {
    ...seat,
    poolId: null,
    liceId: null,
    scopeType: 'match',
    role,
    personId: person.personId,
    name: person.displayName,
  };
  return [...kept, written];
}

const english = createTranslator(messages.en);

/** An Impossible verdict as one refusal, every Impossible reason in words. */
export function impossibleRefusal(
  person: WritePerson,
  skill: RefereeSkill,
  match: WriteMatch,
  reasons: readonly RefereeReason[],
): McpRefusal {
  const why = refereeReasonsText(
    english,
    reasons.filter((r) => r.level === 'impossible'),
  );
  return { refusal: `${person.displayName} cannot take ${skill.name} on ${match.code}: ${why}.` };
}

/** A swap the checker allows: its level and each Discouraged reason with its words. */
export interface SwapVerdict {
  level: 'fine' | 'discouraged';
  warnings: { code: string; text: string }[];
}

/** The one referee checker, through the board (`judgeVerdict`): Impossible refuses. */
export async function judgeSwap(
  deps: McpToolDeps,
  eventId: string,
  match: WriteMatch,
  skill: RefereeSkill,
  person: WritePerson,
): Promise<SwapVerdict | McpRefusal> {
  const { verdict } = await deps.refereeBoard.judgeVerdict(eventId, {
    matchIds: [match.seat.matchId],
    role: skill.id,
    personId: person.personId,
    confirm: false,
  });
  if (verdict.level === 'impossible') {
    return impossibleRefusal(person, skill, match, verdict.reasons);
  }
  return {
    level: verdict.level,
    warnings: verdict.reasons
      .filter((r) => r.level === 'discouraged')
      .map((r) => ({
        code: r.code,
        text: `${person.displayName} ${refereeReasonText(english, r.code, r.against?.label ?? '')}.`,
      })),
  };
}
