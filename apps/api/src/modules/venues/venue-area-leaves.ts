import type { SupabaseService } from '../supabase/supabase.service';

/**
 * What removing a venue area leaves without an area (O25, operator 2026-10-14).
 *
 * `lices.area_id` and `workshop_sessions.area_id` are `ON DELETE SET NULL`: an area removed
 * unlinks, without a word, every Event piste and workshop session it held. The venue window asks
 * first and names them, so the club's venue list carries them per area. Flat reads, not an embed:
 * `workshop_sessions` links both `lices` and `venue_areas`, so an embed from the area to its
 * pistes would be ambiguous.
 */

type Client = SupabaseService['service'];
type Row = Record<string, unknown>;

export interface AreaLeaves {
  pistes: Array<{ name: string; event: string | null }>;
  sessions: Array<{ title: string; startsAt: string; event: string | null }>;
}

function rowsOf(what: string, result: { data: unknown; error: { message: string } | null }): Row[] {
  if (result.error) throw new Error(`${what} could not be read: ${result.error.message}`);
  return (result.data ?? []) as Row[];
}

const one = (embed: unknown): Row | null =>
  (Array.isArray(embed) ? (embed[0] as Row | undefined) : (embed as Row | null)) ?? null;

/** Every area of `venues` gets `leaves`: the pistes and sessions that name it. */
export async function withAreaLeaves(db: Client, venues: Row[]): Promise<Row[]> {
  const areaIds = venues.flatMap((venue) =>
    ((venue['venue_areas'] ?? []) as Row[]).map((area) => String(area['id'])),
  );
  if (areaIds.length === 0) return venues;

  const pistes = rowsOf(
    'The pistes of the areas',
    await db.from('lices').select('area_id, name, event_id').in('area_id', areaIds),
  );
  const sessions = rowsOf(
    'The sessions of the areas',
    await db
      .from('workshop_sessions')
      .select('area_id, starts_at, workshops!inner(title, event_id)')
      .in('area_id', areaIds),
  );
  const eventName = await eventNamesOf(db, [
    ...pistes.map((p) => p['event_id']),
    ...sessions.map((s) => one(s['workshops'])?.['event_id']),
  ]);

  return venues.map((venue) => ({
    ...venue,
    venue_areas: ((venue['venue_areas'] ?? []) as Row[]).map((area) => ({
      ...area,
      leaves: leavesOf(String(area['id']), pistes, sessions, eventName),
    })),
  }));
}

/** The names of the Events these rows belong to, by id. */
async function eventNamesOf(db: Client, ids: unknown[]): Promise<(id: unknown) => string | null> {
  const wanted = [...new Set(ids)].filter((id): id is string => typeof id === 'string');
  const events =
    wanted.length === 0
      ? []
      : rowsOf(
          'The Events of the areas',
          await db.from('events').select('id, name').in('id', wanted),
        );
  return (id) =>
    (events.find((event) => event['id'] === id)?.['name'] as string | undefined) ?? null;
}

function leavesOf(
  areaId: string,
  pistes: Row[],
  sessions: Row[],
  eventName: (id: unknown) => string | null,
): AreaLeaves {
  return {
    pistes: pistes
      .filter((p) => p['area_id'] === areaId)
      .map((p) => ({ name: String(p['name']), event: eventName(p['event_id']) })),
    sessions: sessions
      .filter((s) => s['area_id'] === areaId)
      .map((s) => ({
        title: String(one(s['workshops'])?.['title'] ?? ''),
        startsAt: String(s['starts_at']),
        event: eventName(one(s['workshops'])?.['event_id']),
      })),
  };
}
