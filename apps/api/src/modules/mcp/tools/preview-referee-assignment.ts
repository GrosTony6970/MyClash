/**
 * `preview_referee_assignment` — the read-only half of preview → yes → apply (slice 4a). It
 * says what assigning, swapping or removing one referee on one Match would do, and hands back
 * a sealed confirmation that `apply_referee_assignment` needs. It writes nothing.
 */
import { createTranslator, messages } from '@myclash/i18n';
import type { RefereeReason } from '@myclash/rulesets/scheduling/referee-checker';
import {
  refereeReasonText,
  refereeReasonsText,
} from '@myclash/rulesets/scheduling/referee-reason-text';
import { winningAssignmentRows } from '../../matches/resolve-match-referees';
import { namedBest } from '../../tournament-query/tournament-query.tools.service';
import type { McpCaller, McpToolDeps } from '../mcp-server';
import { isRefusal, type McpRefusal } from './mcp-answer';
import { readableTournamentId, type McpEvent } from './readable-event';
import {
  eventSkills,
  holderOf,
  MATCH_SELECT,
  readCrewRows,
  refereeWriteRefusal,
  toWriteMatch,
  type CrewRow,
  type RefereeSkill,
  type WriteMatch,
} from './referee-write-gate';
import { sealConfirmation } from './write-confirmation';

export interface PreviewRefereeArgs {
  event: string;
  tournament: string;
  /** The bout's round code, as the app shows it (`LSW-P2-M04`). */
  match: string;
  /** The role's name or id. */
  role: string;
  /** The referee's full name; null removes the holder. */
  referee: string | null;
}

export interface PreviewRefereeAnswer {
  match: {
    code: string;
    tournament: string;
    start: string | null;
    timezone: string;
    piste: string | null;
    red: string | null;
    blue: string | null;
  };
  role: string;
  from: string | null;
  to: string | null;
  crewBefore: { role: string; name: string }[];
  crewAfter: { role: string; name: string }[];
  level: 'fine' | 'discouraged';
  warnings: string[];
  confirmation: string;
  expiresAt: string;
  next: string;
}

const english = createTranslator(messages.en);

const NEXT =
  'Show the person this change, the crew after it and every warning; call ' +
  'apply_referee_assignment only after they say yes.';

/** Case and accents folded away, so `declarant` finds `Déclarant`. */
const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLocaleLowerCase();

/** The Tournament's bout with this round code (call O), compared case-blind. */
async function findMatch(
  deps: McpToolDeps,
  tournamentId: string,
  code: string,
): Promise<{ tournament: string; match: WriteMatch } | McpRefusal> {
  const { data: t, error: tError } = await deps.supabase.service
    .from('tournaments')
    .select('name, phases(id)')
    .eq('id', tournamentId)
    .maybeSingle();
  if (tError || !t) throw new Error(`tournament read failed: ${tError?.message ?? 'no row'}`);
  const { name, phases } = t as unknown as { name: string; phases: { id: string }[] | null };
  const phaseIds = (phases ?? []).map((p) => p.id);
  const rows: Record<string, unknown>[] = [];
  if (phaseIds.length > 0) {
    const { data, error } = await deps.supabase.service
      .from('matches')
      .select(MATCH_SELECT)
      .in('phase_id', phaseIds)
      .limit(10_000);
    if (error) throw new Error(`matches read failed: ${error.message}`);
    rows.push(...((data ?? []) as unknown as Record<string, unknown>[]));
  }
  const wanted = code.trim().toLocaleLowerCase();
  const found = rows.map(toWriteMatch).filter((m) => m.code.toLocaleLowerCase() === wanted);
  if (found.length === 0) return { refusal: `No Match "${code}" in ${name}.` };
  if (found.length > 1) {
    return { refusal: `Several Matches of ${name} are "${code}": MyClash cannot tell them apart.` };
  }
  return { tournament: name, match: found[0]! };
}

/** The role by its name or id (call P), case- and accent-blind. */
function findSkill(
  skills: readonly RefereeSkill[],
  text: string,
  event: McpEvent,
): RefereeSkill | McpRefusal {
  const wanted = fold(text.trim());
  const found = skills.filter((s) => fold(s.id) === wanted || fold(s.name) === wanted);
  if (found.length === 1) return found[0]!;
  const names = skills.map((s) => s.name).join(', ');
  if (found.length === 0) {
    return { refusal: `No referee role "${text}" at ${event.name}; its roles are: ${names}.` };
  }
  return {
    refusal: `Several referee roles at ${event.name} are "${text}"; its roles are: ${names}.`,
  };
}

interface RosterPerson {
  personId: string;
  displayName: string;
  clubLabel: string | null;
}

/**
 * The referee by full name (call Q), from the Event's referee roster, one row per person: the
 * panel's matcher (an exact name wins over a "contains"), with the accents folded first.
 */
async function findReferee(
  deps: McpToolDeps,
  event: McpEvent,
  caller: McpCaller,
  text: string,
  skill: RefereeSkill,
): Promise<RosterPerson | McpRefusal> {
  const roster = await deps.qualifications.listEventReferees(event.id, caller.userId);
  const named = namedBest(roster, (r) => fold(r.displayName), fold(text));
  if (named.length === 0) {
    return { refusal: `No referee "${text}" on the referee roster of ${event.name}.` };
  }
  if (named.length > 1) {
    const who = named.map((r) => `${r.displayName} (${r.clubLabel ?? 'no club'})`).join(', ');
    return { refusal: `Several referees of ${event.name} match "${text}": ${who}. Which one?` };
  }
  const person = named[0]!;
  if (!person.qualifications.some((q) => q.skillId === skill.id)) {
    return {
      refusal: `${person.displayName} does not hold the ${skill.name} skill at ${event.name}.`,
    };
  }
  return person;
}

/** A removal takes off only a holder of THIS Match (call M): the RPC deletes Match rows only. */
function removalRefusal(holder: CrewRow | null, skill: RefereeSkill, match: WriteMatch) {
  if (!holder) return { refusal: `Nobody holds ${skill.name} on this Match.` };
  if (holder.scopeType === 'pool') {
    return {
      refusal:
        `${holder.name} holds ${skill.name} for all of Pool ${match.poolNumber}, not this Match ` +
        'alone. Change it on the Pools page, or name someone for this Match.',
    };
  }
  if (holder.scopeType !== 'match') {
    return {
      refusal:
        `${holder.name} holds ${skill.name} for every Match on ${match.piste ?? 'its piste'}, not this Match ` +
        'alone. Change it in MyClash, or name someone for this Match.',
    };
  }
  return null;
}

type Judged = { level: 'fine' | 'discouraged'; warnings: string[]; codes: string[] };

/** The one referee checker, through the board (`judgeVerdict`): Impossible refuses. */
async function judge(
  deps: McpToolDeps,
  eventId: string,
  match: WriteMatch,
  skill: RefereeSkill,
  person: RosterPerson,
): Promise<Judged | McpRefusal> {
  const { verdict } = await deps.refereeBoard.judgeVerdict(eventId, {
    matchIds: [match.seat.matchId],
    role: skill.id,
    personId: person.personId,
    confirm: false,
  });
  const of = (level: RefereeReason['level']) => verdict.reasons.filter((r) => r.level === level);
  if (verdict.level === 'impossible') {
    const why = refereeReasonsText(english, of('impossible'));
    return { refusal: `${person.displayName} cannot take ${skill.name} on ${match.code}: ${why}.` };
  }
  const discouraged = of('discouraged');
  return {
    level: verdict.level,
    warnings: discouraged.map(
      (r) => `${person.displayName} ${refereeReasonText(english, r.code, r.against?.label ?? '')}.`,
    ),
    codes: [...new Set(discouraged.map((r) => r.code))].sort(),
  };
}

/**
 * The crew before and after (call M2): the write replaces the Match's own rows of the role
 * (`replace_match_referee_role`), and the first Match row hides the Pool's whole crew.
 */
function crews(
  rows: CrewRow[],
  match: WriteMatch,
  skill: RefereeSkill,
  person: RosterPerson | null,
  skills: readonly RefereeSkill[],
) {
  const { seat } = match;
  const roleName = (role: string | null) => skills.find((s) => s.id === role)?.name ?? role ?? '';
  const crewOf = (all: CrewRow[]) =>
    winningAssignmentRows(all, seat).map((r) => ({ role: roleName(r.role), name: r.name }));
  const kept = rows.filter(
    (r) => !(r.scopeType === 'match' && r.matchId === seat.matchId && r.role === skill.id),
  );
  const written: CrewRow[] = person
    ? [
        {
          ...seat,
          poolId: null,
          liceId: null,
          scopeType: 'match',
          role: skill.id,
          personId: person.personId,
          name: person.displayName,
        },
      ]
    : [];
  const after = [...kept, ...written];
  // `to` is who holds the role once written: after a removal, the Pool's or Lice's holder of the
  // same role takes the Match back, so "nobody" is said only when nobody holds it.
  const to = holderOf(after, seat, skill.id)?.name ?? null;
  return { to, crewBefore: crewOf(rows), crewAfter: crewOf(after) };
}

/** The bout's two fighters, by the view the schedule grid reads. A failed read throws. */
async function fighters(deps: McpToolDeps, matchId: string) {
  const { data, error } = await deps.supabase.service
    .from('vw_tournament_query_matches')
    .select('red_name, blue_name')
    .eq('match_id', matchId)
    .maybeSingle();
  if (error) throw new Error(`fighter names read failed: ${error.message}`);
  const row = data as { red_name: string | null; blue_name: string | null } | null;
  return { red: row?.red_name?.trim() || null, blue: row?.blue_name?.trim() || null };
}

export async function previewRefereeAssignment(
  args: PreviewRefereeArgs,
  caller: McpCaller,
  deps: McpToolDeps,
): Promise<PreviewRefereeAnswer | McpRefusal> {
  // No key, no token: never answer a preview that apply could not check.
  if (!deps.confirmKey) throw new Error('no confirmation key: SUPABASE_JWT_SECRET is unset');
  const readable = await readableTournamentId(args.event, args.tournament, caller, deps);
  if (isRefusal(readable)) return readable;
  const { event, tournamentId } = readable;
  const gate = await refereeWriteRefusal(event, caller, deps);
  if (gate) return gate;
  const found = await findMatch(deps, tournamentId, args.match);
  if (isRefusal(found)) return found;
  const { match } = found;
  const skills = await eventSkills(deps, event.id);
  const skill = findSkill(skills, args.role, event);
  if (isRefusal(skill)) return skill;
  const person =
    args.referee === null ? null : await findReferee(deps, event, caller, args.referee, skill);
  if (person && isRefusal(person)) return person;

  const rows = await readCrewRows(deps, event.id, match.seat);
  const holder = holderOf(rows, match.seat, skill.id);
  const judged = await decide(deps, event.id, match, skill, person, holder);
  if (isRefusal(judged)) return judged;
  return answerOf(
    { event, tournament: found.tournament, match, skill, person, holder, rows, skills, judged },
    caller,
    deps,
    deps.confirmKey,
  );
}

/**
 * A swap: the same person refuses, else the checker judges. A removal: no judging (taking
 * someone off a slot breaks no referee rule, `matches.service.ts` skips it too), call M only.
 */
async function decide(
  deps: McpToolDeps,
  eventId: string,
  match: WriteMatch,
  skill: RefereeSkill,
  person: RosterPerson | null,
  holder: CrewRow | null,
): Promise<Judged | McpRefusal> {
  if (!person)
    return removalRefusal(holder, skill, match) ?? { level: 'fine', warnings: [], codes: [] };
  if (holder?.personId === person.personId) {
    return { refusal: `${person.displayName} already holds ${skill.name} on ${match.code}.` };
  }
  return judge(deps, eventId, match, skill, person);
}

interface Preview {
  event: McpEvent;
  tournament: string;
  match: WriteMatch;
  skill: RefereeSkill;
  person: RosterPerson | null;
  holder: CrewRow | null;
  rows: CrewRow[];
  skills: readonly RefereeSkill[];
  judged: Judged;
}

/** The answer, with the sealed confirmation: who, the role, the holder at preview, the codes. */
async function answerOf(
  p: Preview,
  caller: McpCaller,
  deps: McpToolDeps,
  key: Buffer,
): Promise<PreviewRefereeAnswer> {
  const { match, skill, person, holder, judged } = p;
  const { token, expiresAt } = sealConfirmation(
    key,
    {
      sub: caller.userId,
      cid: caller.clientId,
      matchId: match.seat.matchId,
      role: skill.id,
      personId: person?.personId ?? null,
      prev: holder?.personId ?? null,
      codes: judged.codes,
    },
    Date.now(),
  );
  return {
    match: {
      code: match.code,
      tournament: p.tournament,
      start: match.start,
      timezone: p.event.timezone,
      piste: match.piste,
      ...(await fighters(deps, match.seat.matchId)),
    },
    role: skill.name,
    from: holder?.name ?? null,
    ...crews(p.rows, match, skill, person, p.skills),
    level: judged.level,
    warnings: judged.warnings,
    confirmation: token,
    expiresAt,
    next: NEXT,
  };
}
