/**
 * A fake server that remembers where every bout sits.
 *
 * The drag harness answered 200 to every write, so the whole drag suite was green
 * on a board that the real API refuses: a run dragged fifteen minutes later left
 * six single PATCHes at once, and the server judged each against bouts that had
 * not moved yet. Bout 1 asked for 11:00 while bout 4 still held 10:58–11:03, so
 * bouts 1–3 were refused, bouts 4–6 moved, and the banner said "3/6 changes were
 * not saved". No test could see it, because the fake server had no memory.
 *
 * This one has. It holds each bout's piste and time, refuses a single PATCH whose
 * window overlaps a bout it has not seen move, and judges a batch as one — the
 * batch's own rows are excluded from what is held, then checked against each
 * other, exactly as `MatchPlacementService` does. Reads serve the moved state.
 *
 * Windows are half-open `[start, start + length)`, the same rule as
 * `lice-occupancy.ts`. The overlap test is written out here rather than imported:
 * root `tests/` is not a workspace package and reaches no `@myclash/*` dist.
 */

/** The single-Match save, `PATCH /matches/:id/schedule`. The board sends none now. */
export const SINGLE_MATCH_PATCH = /\/matches\/[0-9a-f-]{36}\/schedule$/i;

export interface OccupancyRow {
  id: string;
  liceId: string | null;
  scheduledAt: string | null;
  durationMinutes: number;
}

export interface Placement {
  matchId: string;
  liceId: string | null;
  scheduledAt: string | null;
}

/** What the API sends instead of a 200, shaped as problem+json: a 409 for a busy
 *  piste, a 400 for a body its DTO refuses. */
export interface Refusal {
  status: 409 | 400;
  json: { type: string; title: string; status: number; detail: string };
}

interface Window {
  matchId: string;
  liceId: string;
  startMs: number;
  endMs: number;
}

function windowOf(row: OccupancyRow): Window | null {
  if (!row.liceId || !row.scheduledAt) return null;
  const startMs = Date.parse(row.scheduledAt);
  return {
    matchId: row.id,
    liceId: row.liceId,
    startMs,
    endMs: startMs + row.durationMinutes * 60_000,
  };
}

function overlaps(a: Window, b: Window): boolean {
  return a.liceId === b.liceId && a.startMs < b.endMs && b.startMs < a.endMs;
}

function refusal(other: string): Refusal {
  return {
    status: 409,
    json: {
      type: 'about:blank',
      title: 'Conflict',
      status: 409,
      detail: `Piste already busy: this bout overlaps match ${other} on the same piste at the same time. Move one of them, or clear the piste first.`,
    },
  };
}

/**
 * The 400 for a batch `schedule-placements.dto.ts` would refuse: not exactly
 * `{ placements }`, no row or more than 2000, a row with a key missing or extra,
 * or a Match named twice. Without it a board that sent such a body would pass
 * here and be refused by the real API, gesture after gesture.
 */
function unreadableBatch(body: Record<string, unknown>): Refusal | null {
  const rows = body['placements'];
  const readable =
    Object.keys(body).join() === 'placements' &&
    Array.isArray(rows) &&
    rows.length >= 1 &&
    rows.length <= 2000 &&
    rows.every((row) => Object.keys(row).sort().join() === 'liceId,matchId,scheduledAt') &&
    new Set(rows.map((row) => row.matchId)).size === rows.length;
  if (readable) return null;
  const detail = 'The body is not a batch the API accepts.';
  return { status: 400, json: { type: 'about:blank', title: 'Bad Request', status: 400, detail } };
}

export function createPisteOccupancy<R extends OccupancyRow>(rows: readonly R[]) {
  const state = new Map(rows.map((row) => [row.id, { ...row }]));

  /** Check the whole batch, then apply all of it or none. */
  function judge(placements: readonly Placement[]): Refusal | null {
    const moving = new Set(placements.map((p) => p.matchId));
    const held = [...state.values()]
      .filter((row) => !moving.has(row.id))
      .map(windowOf)
      .filter((w): w is Window => w !== null);
    const proposed = placements
      .map((p) => {
        const row = state.get(p.matchId);
        if (!row) throw new Error(`piste occupancy: unknown match ${p.matchId}`);
        return windowOf({ ...row, liceId: p.liceId, scheduledAt: p.scheduledAt });
      })
      .filter((w): w is Window => w !== null);
    for (let i = 0; i < proposed.length; i++) {
      const w = proposed[i]!;
      const other = [...held, ...proposed.slice(i + 1)].find((h) => overlaps(w, h));
      if (other) return refusal(other.matchId);
    }
    for (const p of placements) {
      state.set(p.matchId, {
        ...state.get(p.matchId)!,
        liceId: p.liceId,
        scheduledAt: p.scheduledAt,
      });
    }
    return null;
  }

  return {
    /** `PATCH /matches/:id/schedule` judged as one bout against the rest, `POST
     *  …/schedule/placements` as one batch. Any other write is not this model's. */
    judgeWrite: (path: string, body: Record<string, unknown>): Refusal | null => {
      if (SINGLE_MATCH_PATCH.test(path)) {
        const matchId = path.split('/').slice(-2)[0] as string;
        const field = (key: string) => (body[key] as string | null | undefined) ?? null;
        return judge([{ matchId, liceId: field('liceId'), scheduledAt: field('scheduledAt') }]);
      }
      if (!path.endsWith('/schedule/placements')) return null;
      return unreadableBatch(body) ?? judge(body['placements'] as Placement[]);
    },
    /** What the server holds now, in the rows' own shape — what a read serves. */
    rows: (): R[] => rows.map((row) => ({ ...row, ...state.get(row.id)! })),
  };
}
