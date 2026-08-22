import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_EVENT_TIMEZONE } from '@myclash/time';
import {
  barBlocksOnly,
  loadBootstrap,
  loadRefereeConflictInputs,
  loadRefereeCrewConflicts,
  loadScheduleAndProgramme,
} from './schedule-reads';
import type { ProgrammeBlockRow } from './schedule-types';

/**
 * The board's read path, at the boundary where it parses the API.
 *
 * WHY THESE EXIST. The timezone resolution below used to sit inline in the
 * mount effect next to a comment explaining that it must NOT read `eventTz`
 * state. Deriving conflicts instead of storing them removed the need for that
 * workaround, which also removed the comment — so the rule it encoded needs a
 * test or it is just gone.
 *
 * The browser drag spec cannot cover it. `DEFAULT_EVENT_TIMEZONE` is
 * `Europe/Paris` and the drag fixture's event is `Europe/Paris` too, so an
 * event whose zone is silently dropped renders exactly like one read correctly.
 * On a Paris dev box the browser agrees as well. Three ways to miss the same
 * bug; hence a unit test that names the zone.
 */

const API = 'https://api.test';
const EVENT = 'evt-1';

/**
 * The double answers `text()`, not `json()`: the seam parses one string body
 * and hands the result to every reader. A double that only spoke `json()` came
 * back as a NETWORK failure for every case here.
 */
function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number }): Response {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    text: async () => JSON.stringify(body),
  } as Response;
}

/** The four bootstrap fetches resolve in call order: lices, schedule, event, programme. */
function stubFetch(responses: Response[]): void {
  const queue = [...responses];
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(queue.shift()!)),
  );
}

const EVENT_ROW = {
  start_date: '2026-06-13',
  end_date: '2026-06-14',
  timezone: 'America/New_York',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadBootstrap', () => {
  it("takes the timezone off the event response, not the app's default", async () => {
    stubFetch([jsonResponse([]), jsonResponse([]), jsonResponse(EVENT_ROW), jsonResponse([])]);
    const result = await loadBootstrap(API, EVENT, new AbortController().signal);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.timezone).toBe('America/New_York');
    // The assertion above is only meaningful because the two differ.
    expect(result.data.timezone).not.toBe(DEFAULT_EVENT_TIMEZONE);
  });

  it('falls back to the default only when the event carries no zone', async () => {
    stubFetch([
      jsonResponse([]),
      jsonResponse([]),
      jsonResponse({ ...EVENT_ROW, timezone: null }),
      jsonResponse([]),
    ]);
    const result = await loadBootstrap(API, EVENT, new AbortController().signal);
    expect(result.ok && result.data.timezone).toBe(DEFAULT_EVENT_TIMEZONE);
  });

  it('spans the event start and end into days', async () => {
    stubFetch([jsonResponse([]), jsonResponse([]), jsonResponse(EVENT_ROW), jsonResponse([])]);
    const result = await loadBootstrap(API, EVENT, new AbortController().signal);
    expect(result.ok && result.data.days).toEqual(['2026-06-13', '2026-06-14']);
  });

  it('sorts lices by sortOrder, whatever order the API returned them in', async () => {
    stubFetch([
      jsonResponse([
        { id: 'c', name: 'C', sortOrder: 3 },
        { id: 'a', name: 'A', sortOrder: 1 },
        { id: 'b', name: 'B', sortOrder: 2 },
      ]),
      jsonResponse([]),
      jsonResponse(EVENT_ROW),
      jsonResponse([]),
    ]);
    const result = await loadBootstrap(API, EVENT, new AbortController().signal);
    expect(result.ok && result.data.lices.map((l) => l.id)).toEqual(['a', 'b', 'c']);
  });

  it('keeps only the programme rows the grid draws as bars', async () => {
    stubFetch([
      jsonResponse([]),
      jsonResponse([]),
      jsonResponse(EVENT_ROW),
      jsonResponse([
        { id: '1', blockType: 'admin' },
        { id: '2', blockType: 'competition' },
        { id: '3', blockType: 'break' },
        { id: '4', blockType: 'workshop' },
      ]),
    ]);
    const result = await loadBootstrap(API, EVENT, new AbortController().signal);
    expect(result.ok && result.data.programmeBlocks.map((b) => b.id)).toEqual(['1', '3']);
  });

  describe('when an endpoint refuses', () => {
    const refused = jsonResponse(
      { message: 'permission denied for table lices' },
      {
        ok: false,
        status: 403,
      },
    );

    it('names which endpoint it was and carries the upstream reason', async () => {
      stubFetch([refused, jsonResponse([]), jsonResponse(EVENT_ROW), jsonResponse([])]);
      const result = await loadBootstrap(API, EVENT, new AbortController().signal);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.source).toBe('lices');
      expect(result.failure).toMatchObject({
        kind: 'unauthenticated',
        status: 403,
        detail: 'permission denied for table lices',
        code: null,
        details: null,
      });
    });

    it('reports the first refusal in fetch order when several fail', async () => {
      stubFetch([jsonResponse([]), refused, jsonResponse(EVENT_ROW), refused]);
      const result = await loadBootstrap(API, EVENT, new AbortController().signal);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.source).toBe('schedule');
    });

    // Was: asserts the reported message is the literal "502 Bad Gateway", a
    // string this module invented, in English, and put in the board's banner.
    // An unreadable body means the API never answered for itself.
    it('invents no prose when the body is not JSON', async () => {
      const notJson = {
        ok: false,
        status: 502,
        text: async () => '<html>Bad Gateway</html>',
      } as unknown as Response;
      stubFetch([jsonResponse([]), jsonResponse([]), notJson, jsonResponse([])]);
      const result = await loadBootstrap(API, EVENT, new AbortController().signal);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.source).toBe('event');
      expect(result.failure).toMatchObject({ kind: 'http', status: 502, detail: null });
    });

    // A read the board itself called off — an unmount, or a move to another
    // event. It is a failure like any other here, and the hook above is what
    // knows it has nothing to say about it.
    it('reports an aborted bootstrap as an abort', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.reject(Object.assign(new Error('x'), { name: 'AbortError' }))),
      );
      const result = await loadBootstrap(API, EVENT, new AbortController().signal);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.kind).toBe('aborted');
    });
  });
});

describe('loadScheduleAndProgramme', () => {
  // It used to report a bare status under the "Schedule:" banner whichever of
  // the two refused, which sends the operator to look at the wrong endpoint.
  it('names the refusing endpoint and its reason, not the OK one', async () => {
    stubFetch([jsonResponse([]), jsonResponse({ message: 'gone' }, { ok: false, status: 404 })]);
    const result = await loadScheduleAndProgramme(API, EVENT);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.source).toBe('programme');
    expect(result.failure).toMatchObject({ kind: 'http', status: 404, detail: 'gone' });
  });

  it('filters the programme the same way the bootstrap does', async () => {
    stubFetch([
      jsonResponse([{ id: 'm1' }]),
      jsonResponse([
        { id: '1', blockType: 'break' },
        { id: '2', blockType: 'workshop' },
      ]),
    ]);
    const result = await loadScheduleAndProgramme(API, EVENT);
    expect(result.ok && result.programmeBlocks.map((b) => b.id)).toEqual(['1']);
  });
});

describe('loadRefereeConflictInputs', () => {
  it('hands back the two arms of the join', async () => {
    stubFetch([
      jsonResponse({
        assignments: [{ matchId: 'm1', personId: 'gp-1', personName: 'Denis', role: 'declarant' }],
        registrations: [{ registrationId: 'reg-1', personId: 'gp-1', personName: 'Denis' }],
      }),
    ]);
    const result = await loadRefereeConflictInputs(API, EVENT, new AbortController().signal);
    expect(result).toEqual({
      ok: true,
      assignments: [{ matchId: 'm1', personId: 'gp-1', personName: 'Denis', role: 'declarant' }],
      registrations: [{ registrationId: 'reg-1', personId: 'gp-1', personName: 'Denis' }],
    });
  });

  /**
   * A refusal is a VALUE, not an empty payload. An empty payload derives to
   * zero findings, which on a conflict banner reads as "all clear" — the one
   * thing a read that never happened must not be allowed to say.
   */
  it('reports a refusal by reason rather than returning an empty payload', async () => {
    stubFetch([jsonResponse({ message: 'nope' }, { ok: false, status: 403 })]);
    const result = await loadRefereeConflictInputs(API, EVENT, new AbortController().signal);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toMatchObject({ kind: 'unauthenticated', status: 403, detail: 'nope' });
  });

  it('survives a payload missing an arm', async () => {
    stubFetch([jsonResponse({})]);
    const result = await loadRefereeConflictInputs(API, EVENT, new AbortController().signal);
    expect(result).toEqual({ ok: true, assignments: [], registrations: [] });
  });

  it('asks the event-scoped endpoint', async () => {
    stubFetch([jsonResponse({ assignments: [], registrations: [] })]);
    await loadRefereeConflictInputs(API, EVENT, new AbortController().signal);
    expect(fetch).toHaveBeenCalledWith(
      `${API}/api/v1/events/${EVENT}/referee-match-assignments`,
      expect.objectContaining({ credentials: 'include' }),
    );
  });
});

describe('loadRefereeCrewConflicts', () => {
  const RULES_ALL_ON = { officiateVsFight: true, doubleBooked: true, availability: true };

  it('carries the conflicts, the rules that gate them, and when it looked', async () => {
    stubFetch([
      jsonResponse({
        conflicts: [{ personId: 'gp-1', poolId: 'p1', kind: 'double_booked' }],
        rules: { officiateVsFight: true, doubleBooked: false, availability: true },
        asOf: '2026-06-13T09:30:00.000Z',
      }),
    ]);
    const result = await loadRefereeCrewConflicts(API, EVENT, new AbortController().signal);
    expect(result).toEqual({
      ok: true,
      conflicts: [{ personId: 'gp-1', poolId: 'p1', kind: 'double_booked' }],
      rules: { officiateVsFight: true, doubleBooked: false, availability: true },
      asOf: '2026-06-13T09:30:00.000Z',
    });
  });

  it('reports a refusal by reason', async () => {
    stubFetch([jsonResponse({ message: 'nope' }, { ok: false, status: 403 })]);
    const result = await loadRefereeCrewConflicts(API, EVENT, new AbortController().signal);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toMatchObject({ kind: 'unauthenticated', status: 403, detail: 'nope' });
  });

  /**
   * The important one. A 200 whose body has no `rules` cannot be filled in
   * either way: `true` claims all three checks ran, `false` claims they are
   * switched off, and one of those will be a lie about a payload that said
   * nothing. The banner has a word for that, and it is "unavailable".
   *
   * The drag harness answers every unrouted GET with `[]`, so this is not a
   * hypothetical shape — it is what an unmocked endpoint returns.
   */
  it('refuses a 200 that does not carry the rules, rather than guessing them', async () => {
    stubFetch([jsonResponse({ conflicts: [], asOf: '2026-06-13T09:30:00.000Z' })]);
    const result = await loadRefereeCrewConflicts(API, EVENT, new AbortController().signal);
    // A null failure is the second way this read fails to answer: the server
    // said yes and the body could not be used. There is no status to report,
    // and inventing one reads as a refusal the API never sent.
    expect(result).toEqual({ ok: false, failure: null });
  });

  it('refuses a body that is not an object at all', async () => {
    stubFetch([jsonResponse([])]);
    const result = await loadRefereeCrewConflicts(API, EVENT, new AbortController().signal);
    expect(result).toEqual({ ok: false, failure: null });
  });

  it('refuses a rules object missing one of the three toggles', async () => {
    stubFetch([
      jsonResponse({ conflicts: [], rules: { officiateVsFight: true, doubleBooked: true } }),
    ]);
    const result = await loadRefereeCrewConflicts(API, EVENT, new AbortController().signal);
    expect(result).toEqual({ ok: false, failure: null });
  });

  it('accepts a well-formed body with nothing found', async () => {
    stubFetch([jsonResponse({ conflicts: [], rules: RULES_ALL_ON, asOf: 'x' })]);
    const result = await loadRefereeCrewConflicts(API, EVENT, new AbortController().signal);
    expect(result).toEqual({ ok: true, conflicts: [], rules: RULES_ALL_ON, asOf: 'x' });
  });

  it('asks the slim endpoint, not the whole assignment board', async () => {
    stubFetch([jsonResponse({ conflicts: [], rules: RULES_ALL_ON, asOf: 'x' })]);
    await loadRefereeCrewConflicts(API, EVENT, new AbortController().signal);
    expect(fetch).toHaveBeenCalledWith(
      `${API}/api/v1/events/${EVENT}/referee-crew-conflicts`,
      expect.objectContaining({ credentials: 'include' }),
    );
  });
});

describe('barBlocksOnly', () => {
  it('drops competition and workshop rows, which the matches projection already draws', () => {
    const rows = [
      { blockType: 'admin' },
      { blockType: 'competition' },
      { blockType: 'break' },
      { blockType: 'workshop' },
    ] as ProgrammeBlockRow[];
    expect(barBlocksOnly(rows).map((b) => b.blockType)).toEqual(['admin', 'break']);
  });
});
