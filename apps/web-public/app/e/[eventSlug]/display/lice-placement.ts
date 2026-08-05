/**
 * lice-placement.ts — where a piste physically stands, for the display hub.
 *
 * A tournament can run in parallel across several halls, and a hall can be
 * split into named areas. The screen operator standing in one of those halls
 * needs the picker to say which lice are in front of them; a flat list of
 * bare names makes it guesswork.
 *
 * One owner for the hub's lice shape and its grouping, imported by both the
 * server page and the client Now Live section, so the two cannot drift on
 * how a venue reads or how the list is ordered.
 */

export interface LicePlace {
  id: string;
  name: string;
}

export interface HubLice {
  id: string;
  name: string;
  sortOrder: number;
  venue: LicePlace | null;
  area: LicePlace | null;
}

export interface LiceGroup {
  /** Stable React key — the (venue, area) pair the group stands for. */
  key: string;
  /** null when these lices have no venue set. */
  venueName: string | null;
  /** null when the venue is not split into areas, or none was picked. */
  areaName: string | null;
  lices: HubLice[];
}

/**
 * PostgREST returns a many-to-one embed as an object, but a one-to-one
 * backed by a UNIQUE column comes back as a single-element array — and the
 * shape has flipped under us before when a constraint moved. Normalise both
 * rather than betting on one.
 */
function embedded(value: unknown): LicePlace | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== 'object') return null;
  const record = row as Record<string, unknown>;
  const id = typeof record['id'] === 'string' ? record['id'] : '';
  const name = typeof record['name'] === 'string' ? record['name'].trim() : '';
  if (!id || !name) return null;
  return { id, name };
}

/**
 * Maps one raw `lices` row off `GET /events/:slug`. Returns null for rows
 * that cannot address a display — the kiosk route is keyed by lice NAME, so
 * a nameless row would build a link to nowhere.
 */
export function mapHubLice(row: Record<string, unknown>): HubLice | null {
  const id = String(row['id'] ?? '');
  const name = String(row['name'] ?? '');
  if (!id || !name) return null;
  return {
    id,
    name,
    sortOrder: typeof row['sort_order'] === 'number' ? row['sort_order'] : 0,
    venue: embedded(row['venues']),
    area: embedded(row['venue_areas']),
  };
}

/** Sort key within a group: the admin's column order, names breaking ties. */
function byOrderThenName(a: HubLice, b: HubLice): number {
  return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
}

/**
 * Buckets lices into one group per (venue, area) pair.
 *
 * Lices with no venue collect into a single trailing group with a null
 * `venueName` — placed last because an unplaced piste is an admin oversight,
 * not a section of the venue the operator is standing in. Groups themselves
 * are ordered by venue name then area name so the picker reads the same way
 * on every reload.
 *
 * Always returns groups, even when there is only one. Whether to draw the
 * headings is the page's call: a single-hall event should look exactly as it
 * did before this existed.
 */
export function groupLicesByPlacement(lices: readonly HubLice[]): LiceGroup[] {
  const groups = new Map<string, LiceGroup>();

  for (const lice of lices) {
    const key = `${lice.venue?.id ?? ''}|${lice.area?.id ?? ''}`;
    const group = groups.get(key);
    if (group) {
      group.lices.push(lice);
    } else {
      groups.set(key, {
        key,
        venueName: lice.venue?.name ?? null,
        areaName: lice.venue ? (lice.area?.name ?? null) : null,
        lices: [lice],
      });
    }
  }

  for (const group of groups.values()) group.lices.sort(byOrderThenName);

  return [...groups.values()].sort((a, b) => {
    if (a.venueName === null) return b.venueName === null ? 0 : 1;
    if (b.venueName === null) return -1;
    return (
      a.venueName.localeCompare(b.venueName) || (a.areaName ?? '').localeCompare(b.areaName ?? '')
    );
  });
}

/** The subtitle a card or a heading shows: "Hall — Area", or just one. */
export function placementLabel(venueName: string | null, areaName: string | null): string | null {
  if (venueName && areaName) return `${venueName} — ${areaName}`;
  return venueName ?? areaName ?? null;
}
