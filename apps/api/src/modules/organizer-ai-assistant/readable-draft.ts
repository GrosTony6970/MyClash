import type {
  ReadableDraftAction,
  ReadableMatch,
  ReadableMissing,
  ReadableName,
  ReadablePhase,
  ReadablePool,
} from '@myclash/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { eventZone } from '../../common/event-clock';
import { inListChunks } from '../../common/postgrest-in-list';
import { readInstant } from '../../common/read-instant';
import { containsUuidShape, isUuidShape } from '../../common/uuid-shape';
import { ROUND_CODE_EMBEDS, roundCodeFromMatchRow } from '../matches/round-code.helper';
import { eventSkills } from '../referees/event-skills';
import { rosterDisplayName, type RosterPersonName } from '../referees/roster-display-name';

/**
 * readable-draft.ts — a draft's actions by name (MCP slice 4b, call U). Marie opens a draft and
 * reads "LSW-P2-M04 on Piste 2 at 14:30", never `"matchId": "3f2a…"`.
 *
 * One read per kind of id across every draft given (the list answers up to 50 drafts), each
 * scoped to the Event: an id the Event does not have (a Match deleted since, another Event's
 * Tournament) reads as `missing`, never another Event's name. A failed read THROWS: it must not
 * read as "missing".
 */

type Action = Record<string, unknown>;
type Row = Record<string, unknown>;

const MISSING: ReadableMissing = { missing: true };

/** A row's Tournament, through an embed: its name and its Event. */
interface TournamentEmbed {
  name?: string;
  event_id?: string;
}

/** Every name the drafts' ids resolve to, at this Event. */
interface Names {
  tournaments: Map<string, string>;
  matches: Map<string, ReadableMatch>;
  lices: Map<string, string>;
  pools: Map<string, ReadablePool>;
  phases: Map<string, ReadablePhase>;
  referees: Map<string, string>;
  skills: Map<string, string>;
  zone: string;
}

const isAction = (value: unknown): value is Action =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const count = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const flag = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined;

/**
 * The uuid ids `key` holds across the actions of `kinds`, once each. Any other value is never
 * sent: one value Postgres cannot read as a uuid refuses the whole read (22P02), and the list,
 * the draft and the chat would answer 500. The chat's model passes `"matchId": "LSW-P2-M04"`;
 * that id names no row, so it reads as missing (the draft check refuses it, and the draft is
 * `failed`). Lower-cased, as the database answers ids: the draft check stores ids lower-cased, but
 * a draft saved before that check may still hold an upper-case uuid.
 */
function idsOf(actions: readonly Action[], kinds: readonly string[], key: string): string[] {
  const ids = actions
    .filter((action) => kinds.includes(action['kind'] as string))
    .map((action) => action[key])
    .filter(isUuidShape)
    .map((id) => id.toLowerCase());
  return [...new Set(ids)];
}

/** The rows of `ids`, one read per `IN_LIST_MAX` ids; none when there is no id. Throws. */
async function readByIds(
  ids: readonly string[],
  what: string,
  read: (chunk: string[]) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<Row[]> {
  const pages = await Promise.all(
    inListChunks(ids).map(async (chunk) => {
      const { data, error } = await read(chunk);
      if (error) throw new Error(`${what} read failed: ${error.message}`);
      return (data ?? []) as Row[];
    }),
  );
  return pages.flat();
}

/** The Tournament an embed reaches, when it is this Event's. */
function ownTournament(embed: unknown, eventId: string): string | null {
  const tournament = embed as TournamentEmbed | null | undefined;
  return tournament?.event_id === eventId ? (tournament.name ?? '') : null;
}

async function readTournaments(db: SupabaseClient, eventId: string, ids: string[]) {
  const rows = await readByIds(ids, 'draft Tournaments', (chunk) =>
    db.from('tournaments').select('id, name').eq('event_id', eventId).in('id', chunk),
  );
  return new Map(rows.map((row) => [row['id'] as string, row['name'] as string]));
}

async function readLices(db: SupabaseClient, eventId: string, ids: string[]) {
  const rows = await readByIds(ids, 'draft pistes', (chunk) =>
    db.from('lices').select('id, name').eq('event_id', eventId).in('id', chunk),
  );
  return new Map(rows.map((row) => [row['id'] as string, row['name'] as string]));
}

/** The select of a draft's Matches: the round code's inputs, with the Tournament's name and Event. */
const DRAFT_MATCH_SELECT = `id, match_number_label, phases(config_json,tournaments(weapon,name,event_id)),${ROUND_CODE_EMBEDS}`;

/** A Match has no `event_id`: its Event is its phase's Tournament's, compared per row. */
async function readMatches(db: SupabaseClient, eventId: string, ids: string[]) {
  const rows = await readByIds(ids, 'draft Matches', (chunk) =>
    db.from('matches').select(DRAFT_MATCH_SELECT).in('id', chunk),
  );
  const named = new Map<string, ReadableMatch>();
  for (const row of rows) {
    const phase = row['phases'] as { tournaments?: unknown } | null;
    const tournament = ownTournament(phase?.tournaments, eventId);
    if (tournament === null) continue;
    named.set(row['id'] as string, { code: roundCodeFromMatchRow(row), tournament });
  }
  return named;
}

/** A Pool reaches its Event through its phase's Tournament, compared per row. */
async function readPools(db: SupabaseClient, eventId: string, ids: string[]) {
  const rows = await readByIds(ids, 'draft Pools', (chunk) =>
    db.from('pools').select('id, sort_order, phases(tournaments(name, event_id))').in('id', chunk),
  );
  const named = new Map<string, ReadablePool>();
  for (const row of rows) {
    const phase = row['phases'] as { tournaments?: unknown } | null;
    const tournament = ownTournament(phase?.tournaments, eventId);
    if (tournament === null) continue;
    named.set(row['id'] as string, { number: (row['sort_order'] as number) + 1, tournament });
  }
  return named;
}

/** A phase reaches its Event through its Tournament, compared per row. */
async function readPhases(db: SupabaseClient, eventId: string, ids: string[]) {
  const rows = await readByIds(ids, 'draft phases', (chunk) =>
    db.from('phases').select('id, type, tournaments(name, event_id)').in('id', chunk),
  );
  const named = new Map<string, ReadablePhase>();
  for (const row of rows) {
    const tournament = ownTournament(row['tournaments'], eventId);
    if (tournament === null) continue;
    named.set(row['id'] as string, { type: row['type'] as string, tournament });
  }
  return named;
}

/** A referee is a person on the Event's referee roster, named as the roster names them. */
async function readReferees(db: SupabaseClient, eventId: string, ids: string[]) {
  const rows = await readByIds(ids, 'draft referees', (chunk) =>
    db
      .from('event_referees')
      .select('person_id, global_persons(given_name, family_name, display_name)')
      .eq('event_id', eventId)
      .in('person_id', chunk),
  );
  return new Map(
    rows.map((row) => {
      // A many-to-one embed has come back as an object and as a one-row array.
      const embed = row['global_persons'] as RosterPersonName | RosterPersonName[] | null;
      const person = Array.isArray(embed) ? (embed[0] ?? null) : embed;
      return [row['person_id'] as string, rosterDisplayName(person)];
    }),
  );
}

async function readSkills(db: SupabaseClient, eventId: string, needed: boolean) {
  if (!needed) return new Map<string, string>();
  return new Map((await eventSkills(db, eventId)).map((skill) => [skill.id, skill.name]));
}

/** The Event's zone, read only when a draft places a Match. */
async function readZone(db: SupabaseClient, eventId: string, needed: boolean): Promise<string> {
  if (!needed) return eventZone(null).zone;
  const { data, error } = await db
    .from('events')
    .select('timezone')
    .eq('id', eventId)
    .maybeSingle();
  if (error) throw new Error(`draft Event zone read failed: ${error.message}`);
  return eventZone((data as { timezone?: unknown } | null)?.timezone).zone;
}

async function readNames(db: SupabaseClient, eventId: string, actions: Action[]): Promise<Names> {
  const ids = (kinds: string[], key: string) => idsOf(actions, kinds, key);
  const [tournaments, matches, lices, pools, phases, referees, skills, zone] = await Promise.all([
    readTournaments(db, eventId, ids(['generate_pools', 'generate_bracket'], 'tournamentId')),
    readMatches(db, eventId, ids(['schedule_match', 'assign_referee'], 'matchId')),
    readLices(db, eventId, ids(['schedule_match'], 'liceId')),
    readPools(db, eventId, ids(['assign_referee'], 'poolId')),
    readPhases(db, eventId, ids(['generate_bracket'], 'poolPhaseId')),
    readReferees(db, eventId, ids(['assign_referee'], 'userId')),
    // A role is a `referee_skills.id`, a text key (`custom-…`), not a uuid: not filtered by shape.
    readSkills(
      db,
      eventId,
      actions.some((action) => action['kind'] === 'assign_referee' && text(action['role'])),
    ),
    readZone(
      db,
      eventId,
      actions.some((action) => action['kind'] === 'schedule_match'),
    ),
  ]);
  return { tournaments, matches, lices, pools, phases, referees, skills, zone };
}

/** The name `id` resolves to in `names`, or missing. A uuid matches whatever its case. */
function named<T>(names: Map<string, T>, id: unknown): T | ReadableMissing {
  const key = isUuidShape(id) ? id.toLowerCase() : text(id);
  const found = key === undefined ? undefined : names.get(key);
  return found === undefined ? MISSING : found;
}

const nameOf = (names: Map<string, string>, id: unknown): ReadableName => {
  const found = named(names, id);
  return typeof found === 'string' ? { name: found } : found;
};

/** The start as the placement door reads it (`readInstant`), as ISO; null when it cannot. */
function instant(value: unknown): string | null {
  const parsed = readInstant(value);
  return parsed === null ? null : new Date(parsed).toISOString();
}

/**
 * A text value the model wrote, shown as written. One that holds a uuid shape anywhere is
 * absent (`Sabre Open 3f2a…` included): whatever it is, it would put an id in the names.
 */
const plainText = (value: unknown): string | undefined =>
  containsUuidShape(value) ? undefined : text(value);

/** The name of an optional id: absent when the action holds none, else the name or missing. */
function namedIfGiven<T>(names: Map<string, T>, id: unknown): T | ReadableMissing | undefined {
  return id === undefined || id === null ? undefined : named(names, id);
}

/** One namer per action kind the drafts carry. */
const NAMERS: Record<string, (a: Action, n: Names) => ReadableDraftAction> = {
  create_tournament: (a) => ({
    kind: 'create_tournament',
    name: plainText(a['name']),
    slug: plainText(a['slug']),
    weapon: plainText(a['weapon']),
    rulesetCode: plainText(a['rulesetCode']),
  }),
  generate_pools: (a, n) => ({
    kind: 'generate_pools',
    tournament: nameOf(n.tournaments, a['tournamentId']),
    poolCount: count(a['poolCount']),
    targetSize: count(a['targetSize']),
    schoolSeparation: flag(a['enforceSchoolSeparation']),
    skillBalance: flag(a['enforceSkillBalance']),
    seed: count(a['seed']),
    force: flag(a['force']),
  }),
  generate_bracket: (a, n) => ({
    kind: 'generate_bracket',
    tournament: nameOf(n.tournaments, a['tournamentId']),
    phaseType:
      a['phaseType'] === 'single_elim' || a['phaseType'] === 'double_elim'
        ? a['phaseType']
        : undefined,
    qualifyCount: count(a['qualifyCount']),
    bracketSize: count(a['bracketSize']),
    poolPhase: namedIfGiven(n.phases, a['poolPhaseId']),
    force: flag(a['force']),
  }),
  schedule_match: (a, n) => ({
    kind: 'schedule_match',
    match: named(n.matches, a['matchId']),
    piste: nameOf(n.lices, a['liceId']),
    startsAt: instant(a['scheduledAt']),
    timezone: n.zone,
  }),
  assign_referee: (a, n) => ({
    kind: 'assign_referee',
    referee: nameOf(n.referees, a['userId']),
    role: nameOf(n.skills, a['role']),
    pool: namedIfGiven(n.pools, a['poolId']),
    match: namedIfGiven(n.matches, a['matchId']),
  }),
};

function nameAction(action: unknown, names: Names): ReadableDraftAction {
  if (!isAction(action)) return { kind: 'unsupported' };
  const kind = String(action['kind']);
  // An own key only: a stored kind of `constructor` would find Object.prototype's.
  const namer = Object.hasOwn(NAMERS, kind) ? NAMERS[kind] : undefined;
  return namer ? namer(action, names) : { kind: 'unsupported' };
}

/**
 * Each draft's actions by name, in the order given: `drafts[i]` is the i-th draft's
 * `proposed_actions_json`. One batched read per kind of id across all of them.
 */
export async function readableDraftActions(
  db: SupabaseClient,
  eventId: string,
  drafts: readonly unknown[],
): Promise<ReadableDraftAction[][]> {
  const lists = drafts.map((actions) => (Array.isArray(actions) ? (actions as unknown[]) : []));
  const names = await readNames(db, eventId, lists.flat().filter(isAction));
  return lists.map((actions) => actions.map((action) => nameAction(action, names)));
}
