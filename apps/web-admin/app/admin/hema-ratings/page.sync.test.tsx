import { Activity, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import * as ApiClientModule from '@myclash/api-client';
import { en } from '@myclash/i18n';
import { I18nProvider } from '@/i18n/I18nProvider';
import HemaRatingsAdminPage from './page';

/**
 * "Run sync now" queues the HEMA Ratings job, then reads the fighters every five seconds until
 * their snapshot moves on, or gives up after six minutes. That wait must end whatever React does to
 * the page meanwhile: React may clean an effect up and set it up again while the page stays
 * (Strict Mode as the page wakes up, a hidden `<Activity>` shown again). The cleanup stopped
 * both timers the click had started, so "Syncing…" stayed and the button stayed disabled until
 * a reload. Hiding and showing an `<Activity>` is that cleanup and setup, on demand.
 */
vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

const words = en.admin.hemaRatings;
const FIVE_SECONDS = 5_000;
const SIX_MINUTES = 6 * 60 * 1_000;

const fighter = (syncedAt: string) => ({
  globalPersonId: 'gp-1',
  slug: 'lea-martin',
  displayName: 'Léa Martin',
  givenName: 'Léa',
  familyName: 'Martin',
  clubName: null,
  photoUrl: null,
  hemaRatingsId: '123',
  syncedAt,
  ratings: [],
  lastCompeted: null,
  profileMissing: false,
});

let container: HTMLDivElement;
let root: Root;
/** The snapshot the fighters read answers with. */
let snapshot: string;
const apiRequest = vi.mocked(ApiClientModule.apiRequest);
const fighterReads = () =>
  apiRequest.mock.calls.filter(([, path]) => path === '/api/v1/admin/hema-ratings/fighters').length;

const syncButton = () =>
  [...container.querySelectorAll('button')].find(
    (b) => b.textContent === words.runSyncNow || b.textContent === words.runSyncRunning,
  )!;
const says = (message: string) => container.textContent?.includes(message) ?? false;

function render(mode: 'visible' | 'hidden') {
  act(() =>
    root.render(
      <I18nProvider locale="en">
        <Activity mode={mode}>
          <HemaRatingsAdminPage />
        </Activity>
      </I18nProvider>,
    ),
  );
}

async function wait(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function runSync() {
  await act(async () => {
    syncButton().click();
  });
  expect(syncButton().disabled).toBe(true);
  expect(says(words.syncWaiting)).toBe(true);
}

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  snapshot = '2026-11-03T10:00:00.000Z';
  apiRequest.mockReset();
  apiRequest.mockImplementation(async (_url, path) =>
    path === '/api/v1/admin/hema-ratings/fighters'
      ? { ok: true, data: [fighter(snapshot)] }
      : { ok: true, data: null },
  );
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  render('visible');
  await wait(0);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('the HEMA Ratings sync wait', () => {
  it('ends when the snapshot moves on', async () => {
    await runSync();
    await wait(FIVE_SECONDS);
    expect(says(words.syncCompleted)).toBe(false);

    snapshot = '2026-11-03T10:01:00.000Z';
    await wait(FIVE_SECONDS);
    expect(says(words.syncCompleted)).toBe(true);
    expect(syncButton().disabled).toBe(false);

    // Ended: no more reads, and the six minutes do not come back to say it gave up.
    const reads = fighterReads();
    await wait(SIX_MINUTES);
    expect(fighterReads()).toBe(reads);
    expect(says(words.syncCompleted)).toBe(true);
    expect(says(words.syncTimeout)).toBe(false);
  });

  // The read of 5 min 55 s answers with the new snapshot in the same moment the six minutes end,
  // before React has committed that answer: the wait ends once, as completed.
  it('says completed when the give-up falls due before the page has caught up', async () => {
    await runSync();
    await wait(SIX_MINUTES - FIVE_SECONDS - 1);
    let answer: (result: ApiClient.ApiResult<unknown>) => void = () => undefined;
    apiRequest.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    await wait(1);
    await act(async () => {
      answer({ ok: true, data: [fighter('2026-11-03T10:06:00.000Z')] });
      await vi.advanceTimersByTimeAsync(FIVE_SECONDS);
    });
    expect(says(words.syncCompleted)).toBe(true);
    expect(says(words.syncTimeout)).toBe(false);
  });

  it('says it gave up though a read still on its way then sees the new snapshot', async () => {
    await runSync();
    await wait(SIX_MINUTES - FIVE_SECONDS - 1);
    let answer: (result: ApiClient.ApiResult<unknown>) => void = () => undefined;
    apiRequest.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    // The read of 5 min 55 s leaves and hangs; the wait gives up at 6 min.
    await wait(1 + FIVE_SECONDS);
    expect(says(words.syncTimeout)).toBe(true);

    await act(async () => {
      answer({ ok: true, data: [fighter('2026-11-03T10:06:00.000Z')] });
    });
    expect(says(words.syncTimeout)).toBe(true);
    expect(says(words.syncCompleted)).toBe(false);
  });

  it('says a refused sync and frees the button', async () => {
    apiRequest.mockImplementationOnce(async () => ({
      ok: false,
      kind: 'http',
      status: 503,
      detail: null,
      code: null,
      details: null,
      validationErrors: null,
    }));
    await act(async () => {
      syncButton().click();
    });
    expect(says(words.syncFailed)).toBe(true);
    expect(syncButton().disabled).toBe(false);
    const reads = fighterReads();
    await wait(SIX_MINUTES);
    expect(fighterReads()).toBe(reads);
  });

  it('gives up after six minutes though React sets the page up again meanwhile', async () => {
    await runSync();
    await wait(FIVE_SECONDS);
    render('hidden');
    render('visible');
    expect(syncButton().disabled).toBe(true);

    await wait(SIX_MINUTES);
    expect(says(words.syncTimeout)).toBe(true);
    expect(syncButton().disabled).toBe(false);
  });

  // A timer left running after its page fails a later test (`window is not defined`).
  it('stops reading, and its six minutes, once the page is gone', async () => {
    const started = vi.spyOn(globalThis, 'setTimeout');
    const stopped = vi.spyOn(globalThis, 'clearTimeout');
    await runSync();
    const last = started.mock.calls.findLastIndex(([, ms]) => ms === SIX_MINUTES);
    expect(last).toBeGreaterThanOrEqual(0);
    const giveUp = started.mock.results[last]?.value as ReturnType<typeof setTimeout>;
    expect(stopped).not.toHaveBeenCalledWith(giveUp);

    act(() => root.unmount());
    expect(stopped).toHaveBeenCalledWith(giveUp);
    started.mockRestore();
    stopped.mockRestore();
    const reads = fighterReads();
    await wait(SIX_MINUTES);
    expect(fighterReads()).toBe(reads);
    // afterEach unmounts again: a fresh root keeps that a no-op.
    root = createRoot(container);
  });
});
