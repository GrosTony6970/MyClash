import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadPlannerBlocks, loadPlannerSheet } from './schedule-reads';

/**
 * Ruling 166b. The planner saves the programme and its sheet whole, so it reads them as the
 * organiser. The public programme reads leave a draft Tournament out for a login that lapsed
 * over lunch, and the next Save deleted the draft's bars and bout lengths. The organiser's
 * reads answer that login 401, which the client renews and asks again.
 */

const API = 'https://api.test';
const EVENT = 'evt-1';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(body),
      } as Response),
    ),
  );
}

describe("the planner's reads", () => {
  it("read every bar from the organiser's route, never the public programme", async () => {
    stubFetch([{ id: 'b-1' }]);
    const result = await loadPlannerBlocks(API, EVENT);
    expect(result).toEqual({ ok: true, data: [{ id: 'b-1' }] });
    expect(fetch).toHaveBeenCalledWith(
      `${API}/api/v1/events/${EVENT}/programme/planner/blocks`,
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it("read the sheet and the Tournaments from the organiser's route, never the public ones", async () => {
    const body = { sheet: { tournaments: [] }, tournaments: [{ id: 't-1', name: 'Sabre Cup' }] };
    stubFetch(body);
    const signal = new AbortController().signal;
    const result = await loadPlannerSheet(API, EVENT, signal);
    expect(result).toEqual({ ok: true, data: body });
    expect(fetch).toHaveBeenCalledWith(
      `${API}/api/v1/events/${EVENT}/programme/planner/sheet`,
      expect.objectContaining({ credentials: 'include', signal }),
    );
  });
});
