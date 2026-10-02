/**
 * "Which Event does this write touch?", answered off the route the router matched.
 *
 * One owner, asked by the archived-Event lock and the completed-Event block
 * (`event-readonly.guard.ts`). Returns null when nothing places the request,
 * and the lock reads that as "not about one Event" and lets the write through.
 * So a route this cannot place is an open door, not an error: the holes here
 * all had that shape. `archived-lock.routes.test.ts` lists every write route of
 * the API and fails on one that is placed by nothing and listed nowhere.
 *
 * It reads the matched ROUTE (`request.routeOptions.url`, e.g.
 * `/api/v1/tournaments/:id/publish`) and the decoded params, never
 * `request.url`. The router decodes an address before it matches it:
 * `/api/v1/m%61tches/<id>/exchanges` reaches the matches handler, and a pattern
 * run over the raw address did not see `matches` in it (ruling 222). A query
 * string is no part of the route either.
 *
 * Each `segment/:param` pair is asked once, left to right, and keyed on the
 * SEGMENT, not on the param's name: `params.id`, `params.matchId` and
 * `params.tournamentId` each left routes open, because the routes named their
 * param something else. The one name read is `eventId`: an Event reference
 * wherever it sits. Last, the Event the body names.
 */
import type { FastifyRequest } from 'fastify';
import type { SupabaseService } from '../../modules/supabase/supabase.service';
import { isEventUuid } from '../event-ref';

type Db = SupabaseService['service'];
type Answer = { data: unknown; error: { code?: string; message: string } | null };
type Read = (db: Db, id: string) => PromiseLike<Answer>;

/**
 * The rows a read found, or a plain Error (a 500): a lock that cannot read must
 * not let the write through. An id Postgres cannot read as a uuid (22P02) names
 * no row: the handler's pipe refuses it, after this guard.
 */
export function rowsOf({ data, error }: Answer, what: string): unknown {
  if (!error) return data;
  if (error.code === '22P02') return null;
  throw new Error(`The archived-Event lock could not read ${what}: ${error.message}`);
}

const phaseEvent: Read = (db, id) =>
  db.from('phases').select('tournaments!inner(event_id)').eq('id', id).maybeSingle();

/**
 * From a row to its Event, per URL segment. Each select is a literal, so the
 * schema conformance check reads it, and names one column or one embed.
 */
const EVENT_OF: Readonly<Record<string, Read>> = {
  tournaments: (db, id) => db.from('tournaments').select('event_id').eq('id', id).maybeSingle(),
  phases: phaseEvent,
  'swiss-phases': phaseEvent,
  pools: (db, id) =>
    db.from('pools').select('phases!inner(tournaments!inner(event_id))').eq('id', id).maybeSingle(),
  matches: (db, id) =>
    db
      .from('matches')
      .select('phases!inner(tournaments!inner(event_id))')
      .eq('id', id)
      .maybeSingle(),
  'swiss-rounds': (db, id) =>
    db
      .from('swiss_rounds')
      .select('phases!inner(tournaments!inner(event_id))')
      .eq('id', id)
      .maybeSingle(),
  'bracket-slots': (db, id) =>
    db
      .from('bracket_slots')
      .select('phases!inner(tournaments!inner(event_id))')
      .eq('id', id)
      .maybeSingle(),
  exchanges: (db, id) =>
    db
      .from('exchanges')
      .select('matches!inner(phases!inner(tournaments!inner(event_id)))')
      .eq('id', id)
      .maybeSingle(),
  registrations: (db, id) =>
    db.from('registrations').select('tournaments!inner(event_id)').eq('id', id).maybeSingle(),
  'match-forfeits': (db, id) =>
    db.from('match_forfeits').select('tournaments!inner(event_id)').eq('id', id).maybeSingle(),
  'match-penalties': (db, id) =>
    db.from('match_penalties').select('tournaments!inner(event_id)').eq('id', id).maybeSingle(),
  'tournament-penalty-reviews': (db, id) =>
    db
      .from('tournament_penalty_reviews')
      .select('tournaments!inner(event_id)')
      .eq('id', id)
      .maybeSingle(),
  persons: (db, id) => db.from('persons').select('event_id').eq('id', id).maybeSingle(),
  lices: (db, id) => db.from('lices').select('event_id').eq('id', id).maybeSingle(),
  'referee-assignments': (db, id) =>
    db.from('referee_assignments').select('event_id').eq('id', id).maybeSingle(),
  'referee-qualifications': (db, id) =>
    db.from('referee_qualifications').select('event_id').eq('id', id).maybeSingle(),
  // A system skill has no Event (`event_id` null) and is no Event's row.
  'referee-skills': (db, id) =>
    db.from('referee_skills').select('event_id').eq('id', id).maybeSingle(),
  workshops: (db, id) => db.from('workshops').select('event_id').eq('id', id).maybeSingle(),
  'workshop-sessions': (db, id) =>
    db.from('workshop_sessions').select('workshops!inner(event_id)').eq('id', id).maybeSingle(),
  'workshop-breaks': (db, id) =>
    db.from('workshop_breaks').select('event_id').eq('id', id).maybeSingle(),
};

/** The URL segments whose row the lock reads, for the API-wide test. */
export const PLACING_SEGMENTS: readonly string[] = ['events', ...Object.keys(EVENT_OF)];

export interface Placement {
  /** `events`, or a key of the table above. */
  segment: string;
  value: string;
}

/**
 * The pairs of a route that can name its Event, left to right. Pure: the
 * API-wide test asks it about every route without a database.
 */
export function placementsOf(
  pattern: string,
  params: Readonly<Record<string, string | undefined>>,
): Placement[] {
  const parts = pattern.split('/');
  const found: Placement[] = [];
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i] as string;
    if (!part.startsWith(':')) continue;
    const name = part.slice(1);
    const segment = name === 'eventId' ? 'events' : (parts[i - 1] as string);
    const value = params[name];
    if (value && (segment === 'events' || Object.hasOwn(EVENT_OF, segment))) {
      found.push({ segment, value });
    }
  }
  return found;
}

/** Any version, as Postgres and `ParseUUIDPipe` read one. */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * An Event named by id or by slug, read as the handlers read it. `event-ref.ts`
 * takes an RFC uuid for an id and anything else for a slug; `ParseUUIDPipe`
 * takes any uuid for an id. So a uuid of no RFC version is looked for as both.
 * A slug is unique within one organisation only (`UNIQUE(organization_id,
 * slug)`): two Events of that slug place nothing, and `event-ref.ts` finds no
 * Event either.
 */
async function eventOfReference(db: Db, ref: string): Promise<string | null> {
  if (isEventUuid(ref)) return ref;
  if (UUID_SHAPE.test(ref)) {
    const byId = await db.from('events').select('id').eq('id', ref).maybeSingle();
    if (rowsOf(byId, 'an Event')) return ref;
  }
  const bySlug = await db.from('events').select('id').eq('slug', ref).limit(2);
  const rows = (rowsOf(bySlug, 'an Event') ?? []) as Array<{ id: string }>;
  return rows.length === 1 ? (rows[0] as { id: string }).id : null;
}

/**
 * The `event_id` at the end of an answer's embeds. A to-one embed the typed
 * client hands back as an array is walked like a row: its values are its items.
 */
function eventIn(answer: unknown): string | null {
  let node = answer;
  while (node !== null && typeof node === 'object') {
    const row = node as Record<string, unknown>;
    if (typeof row['event_id'] === 'string') return row['event_id'];
    node = Object.values(row).find((value) => value !== null && typeof value === 'object');
  }
  return null;
}

export async function resolveEventId(
  supabase: SupabaseService,
  request: FastifyRequest,
): Promise<string | null> {
  const pattern = request.routeOptions?.url;
  // Behind the router every request has one. A hand-built request without it
  // would place nothing and pass: refuse to answer instead.
  if (!pattern) throw new Error(`${request.method} ${request.url}: no matched route to read`);

  const params = (request.params ?? {}) as Record<string, string | undefined>;
  for (const { segment, value } of placementsOf(pattern, params)) {
    const read = EVENT_OF[segment];
    const eventId = read
      ? eventIn(rowsOf(await read(supabase.service, value), segment))
      : await eventOfReference(supabase.service, value);
    if (eventId) return eventId;
  }

  // Every body that names its Event names it as a uuid (`z.uuid()`); anything
  // else is the validation pipe's to refuse, after this guard.
  const named = (request.body as Record<string, unknown> | null | undefined)?.['eventId'];
  return typeof named === 'string' && UUID_SHAPE.test(named) ? named : null;
}
