/**
 * `apply_referee_assignment` — the write half of preview → yes → apply (slice 4a). It takes
 * nothing but the sealed confirmation `preview_referee_assignment` handed out, asks every
 * question of the preview again, writes the one change, and leaves an audit row.
 *
 * The race it handles: someone changes the bout's referee in the app between preview and
 * apply. The holder must still be the one the preview saw (call H), and a warning the person
 * did not see refuses (call I). A replay of the token meets the new holder and refuses.
 *
 * The race it closes: two applies of one Event at once (two Matches that overlap, one referee).
 * Each would judge before the other's write lands, and both would pass. The recheck and the
 * write run one apply at a time per Event (`runOnePerEvent`, in this process only), so the
 * second judges a crew that holds the first's write.
 *
 * The race it accepts: the write does not compare the holder again. A change made in the app
 * between the crew re-read and the write is overwritten, and the audit row's `previousPersonId`
 * names the holder the re-read saw. The window is the roster read, the checker and the write's
 * own board-lock and checker reads, all database reads of milliseconds: the app name, the one call to
 * the auth server, is read before the re-read so it cannot stretch the window. The write still
 * refuses an Impossible reason born in it; a Discouraged one only when the preview showed none
 * (`confirm` false), as the plan's "race, named" accepts.
 */
import { ConflictException, Logger } from '@nestjs/common';
import type { RefereeReason } from '@myclash/rulesets/scheduling/referee-checker';
import { insertAuditLog } from '../../../common/audit-log';
import type { McpCaller, McpToolDeps } from '../mcp-server';
import { isRefusal, type McpRefusal } from './mcp-answer';
import { runOnePerEvent } from './one-write-per-event';
import {
  eventSkills,
  holderOf,
  impossibleRefusal,
  judgeSwap,
  LOCKED_REFUSAL,
  maintenanceRefusal,
  MATCH_SELECT,
  missingSkillRefusal,
  readCrewRows,
  refereeWriteRefusal,
  rowsAfterWrite,
  toWriteMatch,
  type GateEvent,
  type RefereeSkill,
  type RosterReferee,
  type WriteMatch,
  type WritePerson,
} from './referee-write-gate';
import { openConfirmation, type ConfirmationPayload } from './write-confirmation';

const logger = new Logger('ApplyRefereeAssignment');

export interface ApplyRefereeAnswer {
  result: 'Done';
  match: string;
  role: string;
  from: string | null;
  to: string | null;
}

const STALE: McpRefusal = {
  refusal: 'This confirmation is not valid any more. Preview the change again.',
};

const changed = (match: WriteMatch): McpRefusal => ({
  refusal: `The referees of ${match.code} changed since the preview. Preview the change again.`,
});

/**
 * The preview's bout select with the Event inside the round code's own `phases` embed: one
 * embed of `phases`, not two. Should `ROUND_CODE_INPUTS` stop naming `tournaments(weapon)`, the
 * replace finds nothing, `readMatch` throws "no Event embed" and the select pin goes red.
 */
export const APPLY_MATCH_SELECT = MATCH_SELECT.replace(
  'tournaments(weapon)',
  'tournaments(weapon,events(id,name,status))',
);

/** The bout and its Event, from the Match row (never from the token); null when it is gone. */
async function readMatch(
  deps: McpToolDeps,
  matchId: string,
): Promise<{ event: GateEvent; match: WriteMatch } | null> {
  const { data, error } = await deps.supabase.service
    .from('matches')
    .select(APPLY_MATCH_SELECT)
    .eq('id', matchId)
    .maybeSingle();
  if (error) throw new Error(`match read failed: ${error.message}`);
  if (!data) return null;
  const row = data as unknown as Record<string, unknown>;
  const phase = row['phases'] as { tournaments?: { events?: GateEvent | null } | null } | null;
  const event = phase?.tournaments?.events;
  if (!event) throw new Error('match read failed: no Event embed');
  return { event, match: toWriteMatch(row) };
}

/** The new referee as the roster lists them now; null when they left the roster. */
async function rosterPerson(
  deps: McpToolDeps,
  eventId: string,
  caller: McpCaller,
  personId: string,
): Promise<RosterReferee | null> {
  const roster = await deps.qualifications.listEventReferees(eventId, caller.userId);
  return roster.find((r) => r.personId === personId) ?? null;
}

type Checked = { from: string | null; to: string | null; person: WritePerson | null };

/**
 * The preview's questions again, on the crew as it is now: the holder is still `prev` (call H);
 * a removal still takes off a Match row (call M); a swap's referee still holds the role's
 * skill, the swap is judged again, and a warning the person did not see refuses (call I).
 * Answers who held the role, who will, and the new one.
 */
async function recheck(
  deps: McpToolDeps,
  caller: McpCaller,
  token: ConfirmationPayload,
  event: GateEvent,
  found: { match: WriteMatch; skill: RefereeSkill },
): Promise<Checked | McpRefusal> {
  const { match, skill } = found;
  const rows = await readCrewRows(deps, event.id, match.seat);
  const holder = holderOf(rows, match.seat, skill.id);
  if ((holder?.personId ?? null) !== token.prev) return changed(match);
  let person: WritePerson | null = null;
  if (token.personId === null) {
    if (holder?.scopeType !== 'match') return changed(match);
  } else {
    const listed = await rosterPerson(deps, event.id, caller, token.personId);
    if (!listed) return changed(match);
    // Before the checker, whose skill check would throw a 400: the generic failure.
    const unskilled = missingSkillRefusal(listed, skill, event);
    if (unskilled) return unskilled;
    person = listed;
    const verdict = await judgeSwap(deps, event.id, match, skill, person);
    if (isRefusal(verdict)) return verdict;
    const unseen = verdict.warnings.filter((w) => !token.codes.includes(w.code));
    if (unseen.length > 0) {
      const words = unseen.map((w) => w.text).join(' ');
      return { refusal: `Something changed since the preview: ${words} Preview the change again.` };
    }
  }
  const after = rowsAfterWrite(rows, match.seat, skill.id, person);
  const to = holderOf(after, match.seat, skill.id)?.name ?? null;
  return { from: holder?.name ?? null, to, person };
}

/**
 * The connector app's name for the audit row (call L, ruling 990). It is the name the app gave
 * itself when it registered with the auth server: what it calls itself, not a name we checked.
 * A failed read leaves it null and the write goes on: the person is the actor either way.
 */
async function appName(deps: McpToolDeps, clientId: string): Promise<string | null> {
  try {
    const { data, error } = await deps.supabase.service.auth.admin.oauth.getClient(clientId);
    if (error) {
      logger.warn(`connector app name read failed: ${error.status ?? '-'} ${error.code ?? '-'}`);
      return null;
    }
    if (typeof data?.client_name !== 'string' || data.client_name === '') {
      logger.warn('connector app name read answered no client_name');
      return null;
    }
    return data.client_name;
  } catch (thrown) {
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    logger.warn(`connector app name read threw: ${message}`);
    return null;
  }
}

/**
 * The write. It asks the lock and judges again inside; each 409 it refuses with is a refusal
 * here. `referee_needs_confirmation` is a warning born between the recheck and the write.
 */
async function write(
  deps: McpToolDeps,
  token: ConfirmationPayload,
  found: { match: WriteMatch; skill: RefereeSkill },
  person: WritePerson | null,
): Promise<McpRefusal | null> {
  try {
    const confirm = token.codes.length > 0;
    await deps.matches.setRefereeRoleAssignment(token.matchId, token.role, token.personId, confirm);
    return null;
  } catch (refused) {
    if (!(refused instanceof ConflictException)) throw refused;
    const body = refused.getResponse() as { code?: unknown; reasons?: RefereeReason[] };
    if (body.code === 'referee_board_locked') return LOCKED_REFUSAL;
    if (body.code === 'referee_needs_confirmation') return changed(found.match);
    if (body.code === 'referee_impossible' && person) {
      return impossibleRefusal(person, found.skill, found.match, body.reasons ?? []);
    }
    throw refused;
  }
}

export async function applyRefereeAssignment(
  confirmation: string,
  caller: McpCaller,
  deps: McpToolDeps,
): Promise<ApplyRefereeAnswer | McpRefusal> {
  // Maintenance first: before the token is opened or anything is read.
  const maintenance = await maintenanceRefusal(deps);
  if (maintenance) return maintenance;
  if (!deps.confirmKey) throw new Error('no confirmation key: SUPABASE_JWT_SECRET is unset');
  const token = openConfirmation(deps.confirmKey, confirmation, caller, Date.now());
  if (!token) return STALE;
  const read = await readMatch(deps, token.matchId);
  if (!read) return STALE;
  const { event, match } = read;
  const gate = await refereeWriteRefusal(event, caller, deps);
  if (gate) return gate;
  // Before the recheck and the lock: this call goes to the auth server, with no timeout of
  // ours. Between the crew re-read and the write there is no call to the auth server, only
  // database reads, so no apply of the Event waits on the auth server.
  const clientName = await appName(deps, caller.clientId);
  const skill = (await eventSkills(deps, event.id)).find((s) => s.id === token.role);
  if (!skill) return STALE;
  // One recheck-and-write at a time per Event: a second apply judges after the first wrote.
  const checked = await runOnePerEvent(event.id, async () => {
    const seen = await recheck(deps, caller, token, event, { match, skill });
    if (isRefusal(seen)) return seen;
    return (await write(deps, token, { match, skill }, seen.person)) ?? seen;
  });
  if (isRefusal(checked)) return checked;
  await audit(deps, caller, token, { clientName, roleName: skill.name });
  return {
    result: 'Done',
    match: match.code,
    role: skill.name,
    from: checked.from,
    to: checked.to,
  };
}

/**
 * The audit row, after the write only. A failed insert is logged, never the write's failure.
 * `roleName` beside `role`: the skill id is a technical string (`arbitre_declarant`, `custom-…`).
 */
async function audit(
  deps: McpToolDeps,
  caller: McpCaller,
  token: ConfirmationPayload,
  names: { clientName: string | null; roleName: string },
): Promise<void> {
  const action =
    token.personId === null ? 'match.referee_role_removed' : 'match.referee_role_assigned';
  const { error } = await insertAuditLog(deps.supabase.service, {
    actorUserId: caller.userId,
    action,
    entityType: 'match',
    entityId: token.matchId,
    payload: {
      via: 'mcp',
      clientId: caller.clientId,
      clientName: names.clientName,
      role: token.role,
      roleName: names.roleName,
      previousPersonId: token.prev,
      personId: token.personId,
      confirmedReasons: token.codes,
    },
  });
  if (error) logger.error(`Could not write audit log for ${action} on match:${token.matchId}`);
}
