import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SparFlagListItem, SparFlagPage } from '@myclash/types';
import * as ApiClient from '@myclash/api-client';
import { I18nProvider } from '@/i18n/I18nProvider';
import { SparFlagList } from './SparFlagList';
import type { FlagScope } from './spar-flag-paths';

vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

const CLUB: FlagScope = { kind: 'club', orgId: 'org1' };
const PLATFORM: FlagScope = { kind: 'platform' };
const CLUB_PAGE = (n: number) => `/api/v1/organizations/org1/fightbook/flags?page=${n}`;
const PLATFORM_PAGE = (n: number) => `/api/v1/admin/fightbook/flags?page=${n}`;
const CLUB_MARK = (id: string) => `/api/v1/organizations/org1/fightbook/flags/${id}/handled`;

const fighter = (name: string) => ({ globalPersonId: 'g', name, photoUrl: null, club: null });
const flag = (over: Partial<SparFlagListItem> = {}): SparFlagListItem => ({
  id: 'f1',
  createdAt: '2026-11-10T09:00:00.000Z',
  reason: 'equipment',
  text: 'The mask strap tore in the second bout.',
  reporter: fighter('Reporter One'),
  flagged: fighter('Flagged Two'),
  kind: 'event',
  eventName: 'Open 2026',
  club: 'Lyon AMHE',
  day: '2026-11-08',
  place: null,
  weapons: ['Longsword', 'Sabre'],
  handled: false,
  ...over,
});

const FORBIDDEN = {
  ok: false,
  kind: 'unauthenticated',
  status: 403,
  detail: 'Forbidden',
  code: null,
  details: null,
};

const UNREADABLE = {
  ok: false,
  kind: 'http',
  status: 400,
  detail: null,
  code: null,
  details: null,
  validationErrors: null,
};

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

type Answer = SparFlagPage | typeof FORBIDDEN | 'fail';

/** Reads answer by path; a write answers 204 unless `writes[path]` says 'fail'. */
async function open(
  scope: FlagScope,
  reads: Record<string, Answer>,
  writes?: Record<string, 'fail'>,
) {
  vi.mocked(ApiClient.apiRequest).mockImplementation(async (_base, path, init) => {
    if (init?.method && init.method !== 'GET') {
      return writes?.[path] === 'fail'
        ? ({ ok: false, kind: 'network' } as never)
        : ({ ok: true, data: undefined } as never);
    }
    const answer = reads[path];
    if (answer === undefined) throw new Error(`unexpected read ${path}`);
    if (answer === 'fail') return UNREADABLE as never;
    if ('ok' in answer) return answer as never;
    return { ok: true, data: answer } as never;
  });
  const container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <I18nProvider locale="en">
        <SparFlagList scope={scope} />
      </I18nProvider>,
    );
  });
  await settle();
}

const text = () => document.body.textContent ?? '';
const calls = () =>
  vi
    .mocked(ApiClient.apiRequest)
    .mock.calls.map(([, path, init]) => `${init?.method ?? 'GET'} ${path}`);
const box = () => document.body.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
const click = async (el: HTMLElement) => {
  await act(async () => el.click());
  await settle();
};
const showMore = () =>
  [...document.body.querySelectorAll('button')].find((b) => b.textContent === 'Show more');

describe('a safety report row', () => {
  it('shows the date, reason, text, both names, the day, the Event, the weapons and Handled', async () => {
    await open(CLUB, { [CLUB_PAGE(0)]: { items: [flag()], more: false } });
    expect(text()).toContain('10 Nov 2026');
    expect(text()).toContain('Unsafe equipment');
    expect(text()).toContain('The mask strap tore in the second bout.');
    expect(text()).toContain('Reporter One');
    expect(text()).toContain('Flagged Two');
    expect(text()).toContain('8 Nov 2026');
    expect(text()).toContain('Open 2026');
    expect(text()).toContain('Longsword, Sabre');
    expect(text()).toContain('Handled');
    expect(box().checked).toBe(false);
  });

  it("dates a report in the viewer's zone, not UTC", async () => {
    const before = process.env.TZ;
    process.env.TZ = 'Pacific/Auckland';
    try {
      const late = flag({ createdAt: '2026-11-10T23:30:00.000Z', day: '2026-11-08' });
      await open(CLUB, { [CLUB_PAGE(0)]: { items: [late], more: false } });
      expect(text()).toContain('11 Nov 2026');
      expect(text()).toContain('8 Nov 2026');
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    }
  });

  it('names the place of a free spar', async () => {
    const free = flag({ kind: 'free', eventName: null, place: 'Salle Voltaire' });
    await open(CLUB, { [CLUB_PAGE(0)]: { items: [free], more: false } });
    expect(text()).toContain('Salle Voltaire');
  });

  it('says "An erased account" when the reporter is gone', async () => {
    await open(CLUB, { [CLUB_PAGE(0)]: { items: [flag({ reporter: null })], more: false } });
    expect(text()).toContain('An erased account');
  });

  it('shows the club on the platform list only', async () => {
    await open(PLATFORM, { [PLATFORM_PAGE(0)]: { items: [flag()], more: false } });
    expect(text()).toContain('Lyon AMHE');
    act(() => root?.unmount());
    document.body.innerHTML = '';
    await open(CLUB, { [CLUB_PAGE(0)]: { items: [flag()], more: false } });
    expect(text()).not.toContain('Lyon AMHE');
  });

  it('shows a handled report with its box ticked', async () => {
    await open(CLUB, { [CLUB_PAGE(0)]: { items: [flag({ handled: true })], more: false } });
    expect(box().checked).toBe(true);
  });
});

describe('the Handled box', () => {
  const one = { [CLUB_PAGE(0)]: { items: [flag()], more: false } };

  it('ticking PUTs the mark, unticking DELETEs it', async () => {
    await open(CLUB, one);
    await click(box());
    expect(calls()).toContain(`PUT ${CLUB_MARK('f1')}`);
    expect(box().checked).toBe(true);
    await click(box());
    expect(calls()).toContain(`DELETE ${CLUB_MARK('f1')}`);
    expect(box().checked).toBe(false);
  });

  it('uses the platform path on the platform list', async () => {
    await open(PLATFORM, { [PLATFORM_PAGE(0)]: { items: [flag()], more: false } });
    await click(box());
    expect(calls()).toContain('PUT /api/v1/admin/fightbook/flags/f1/handled');
  });

  it('puts the box back and says so when the write fails', async () => {
    await open(CLUB, one, { [CLUB_MARK('f1')]: 'fail' });
    await click(box());
    expect(box().checked).toBe(false);
    expect(text()).toContain('The Handled mark could not be saved. It was put back.');
  });

  it('disables the box while its write runs, so a second tick cannot race the first', async () => {
    await open(CLUB, one);
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    vi.mocked(ApiClient.apiRequest).mockImplementation(async () => {
      await held;
      return { ok: true, data: undefined } as never;
    });
    await act(async () => box().click());
    expect(box().disabled).toBe(true);
    release();
    await settle();
    expect(box().disabled).toBe(false);
    expect(box().checked).toBe(true);
  });
});

describe('the list around the rows', () => {
  it('shows "No safety reports" when there are none', async () => {
    await open(CLUB, { [CLUB_PAGE(0)]: { items: [], more: false } });
    expect(text()).toContain('No safety reports');
  });

  it('"Show more" asks page 1 and appends, and goes away on the last page', async () => {
    await open(CLUB, {
      [CLUB_PAGE(0)]: { items: [flag()], more: true },
      [CLUB_PAGE(1)]: { items: [flag({ id: 'f2', text: 'Second report.' })], more: false },
    });
    expect(text()).not.toContain('Second report.');
    await click(showMore()!);
    expect(calls()).toContain(`GET ${CLUB_PAGE(1)}`);
    expect(text()).toContain('The mask strap tore in the second bout.');
    expect(text()).toContain('Second report.');
    expect(showMore()).toBeUndefined();
  });

  it('does not re-read page 0 over the appended pages when the language changes', async () => {
    await open(CLUB, {
      [CLUB_PAGE(0)]: { items: [flag()], more: true },
      [CLUB_PAGE(1)]: { items: [flag({ id: 'f2', text: 'Second report.' })], more: false },
    });
    await click(showMore()!);
    await act(async () => {
      root!.render(
        <I18nProvider locale="fr">
          <SparFlagList scope={CLUB} />
        </I18nProvider>,
      );
    });
    await settle();
    expect(calls().filter((c) => c === `GET ${CLUB_PAGE(0)}`)).toHaveLength(1);
    expect(text()).toContain('Second report.');
  });

  it('has no "Show more" when the page is the last', async () => {
    await open(CLUB, { [CLUB_PAGE(0)]: { items: [flag()], more: false } });
    expect(showMore()).toBeUndefined();
  });

  it('tells a club member who is not an admin that only admins read the reports', async () => {
    await open(CLUB, { [CLUB_PAGE(0)]: FORBIDDEN });
    expect(text()).toContain("Only the club's admins can read safety reports");
  });

  it('says the reports could not be loaded when the read fails', async () => {
    await open(CLUB, { [CLUB_PAGE(0)]: 'fail' });
    expect(text()).toContain('The safety reports could not be loaded.');
  });
});
