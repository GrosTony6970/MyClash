import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_EVENT_TIMEZONE } from '@myclash/time';
import { barBlocksOnly, loadBootstrap, loadScheduleAndProgramme } from './schedule-reads';
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

function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number }): Response {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    statusText: 'Test',
    json: async () => body,
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

    it('names which endpoint it was and carries the upstream message', async () => {
      stubFetch([refused, jsonResponse([]), jsonResponse(EVENT_ROW), jsonResponse([])]);
      const result = await loadBootstrap(API, EVENT, new AbortController().signal);
      expect(result).toEqual({
        ok: false,
        source: 'lices',
        message: 'permission denied for table lices',
      });
    });

    it('reports the first refusal in fetch order when several fail', async () => {
      stubFetch([jsonResponse([]), refused, jsonResponse(EVENT_ROW), refused]);
      const result = await loadBootstrap(API, EVENT, new AbortController().signal);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.source).toBe('schedule');
    });

    it('falls back to the status line when the body is not JSON', async () => {
      const notJson = {
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        json: async () => {
          throw new Error('not json');
        },
      } as unknown as Response;
      stubFetch([jsonResponse([]), jsonResponse([]), notJson, jsonResponse([])]);
      const result = await loadBootstrap(API, EVENT, new AbortController().signal);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.source).toBe('event');
      expect(result.message).toBe('502 Bad Gateway');
    });
  });
});

describe('loadScheduleAndProgramme', () => {
  it('reports the refusing response status, not the OK one', async () => {
    stubFetch([jsonResponse([]), jsonResponse({ message: 'gone' }, { ok: false, status: 404 })]);
    const result = await loadScheduleAndProgramme(API, EVENT);
    expect(result).toEqual({ ok: false, status: 404 });
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
