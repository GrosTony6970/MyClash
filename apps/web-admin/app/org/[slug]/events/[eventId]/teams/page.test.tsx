import { act, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import {
  EVENT_ID,
  EVENTS_READ,
  openEventPage,
  type,
  type OpenedPage,
} from '../archived-page.fixtures';
import EventTeamsPage from './page';

/**
 * The Teams page (Team Tournaments, slice 1b-1): the teams of the Event's team Tournaments, and
 * their create, save, delete and logo, each sent to `tournaments/:id/teams` (T3). Every refusal
 * the API names is said in words.
 */
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'club', eventId: 'ev1' }),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/org/club/events/ev1/teams',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

type Answer = Awaited<ReturnType<typeof apiRequest>>;

const TEAMS = '/api/v1/tournaments/tt-1/teams';
const LYON = {
  id: 'team-1',
  tournamentId: 'tt-1',
  name: 'Lyon Blades',
  slug: 'lyon-blades',
  size: 3,
  seed: 1,
  color: 'blue',
  logoUrl: 'http://img.test/lyon.png',
};
const READS = {
  [`/api/v1/events/${EVENT_ID}`]: { id: EVENT_ID, name: 'Open 2026', status: 'published' },
  [`/api/v1/events/${EVENT_ID}/tournaments`]: [
    { id: 't-1', name: 'Longsword', status: 'draft', entrant_kind: 'individual' },
    {
      id: 'tt-1',
      name: 'Team Longsword',
      status: 'draft',
      color: 'red',
      entrant_kind: 'team',
      team_default_size: 4,
    },
  ],
  [TEAMS]: [LYON],
};

let page: OpenedPage;
afterEach(() => page.unmount());

/** Every write the page sent: method, path and body. */
let sent: Array<{ method: string; path: string; body: unknown }> = [];

/** Opens the page; every write answers `answer` (taken, by default). */
async function open(reads: Record<string, unknown> = READS, answer: Answer = taken) {
  page = await openEventPage(<EventTeamsPage />, reads);
  sent = [];
  const read = vi.mocked(apiRequest).getMockImplementation()!;
  vi.mocked(apiRequest).mockImplementation(async (base, path, init) => {
    if (!init?.method || init.method === 'GET') return read(base, path, init);
    sent.push({ method: init.method, path, body: init.body });
    return answer;
  });
}
const taken = { ok: true, data: {} } as Answer;
const refused = (status: number, code: string | null, details: Record<string, unknown> | null) =>
  ({
    ok: false,
    kind: 'http',
    status,
    detail: 'An English reason the screen must not show.',
    code,
    details,
    validationErrors: null,
  }) as Answer;

const body = () => document.body;
const dialog = () => body().querySelector<HTMLElement>('[role="dialog"]');
const field = <T extends HTMLElement>(testId: string) =>
  body().querySelector<T>(`[data-testid="${testId}"]`)!;
async function press(label: string, within: ParentNode = body()) {
  const button = [...within.querySelectorAll('button')].find((b) => b.textContent === label);
  if (!button) throw new Error(`no button "${label}"`);
  await act(async () => button.click());
  await page.settle();
}
async function fill(testId: string, value: string) {
  await act(async () => type(field<HTMLInputElement>(testId), value));
}

describe('the Teams page', () => {
  it('lists the teams of the team Tournament: logo, name, size, seed', async () => {
    await open();
    const rows = [...body().querySelectorAll('[data-testid="team-row"]')];
    expect(rows.map((r) => r.textContent)).toEqual(['Lyon Blades31EditDelete']);
    expect(rows[0]!.querySelector('img')?.getAttribute('src')).toBe('http://img.test/lyon.png');
    // One team Tournament: no tabs to pick it.
    expect(body().querySelector('[role="tablist"][aria-label="Team tournaments"]')).toBeNull();
  });

  it('offers a tab per team Tournament, and none for an individual one', async () => {
    const tournaments = READS[`/api/v1/events/${EVENT_ID}/tournaments`];
    await open({
      ...READS,
      [`/api/v1/events/${EVENT_ID}/tournaments`]: [
        ...tournaments,
        { id: 'tt-2', name: 'Team Sabre', status: 'draft', entrant_kind: 'team' },
      ],
    });
    const tabs = body().querySelector('[role="tablist"][aria-label="Team tournaments"]');
    expect([...tabs!.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'Team Longsword',
      'Team Sabre',
    ]);
  });

  it('creates a team: its size starts at the Tournament default, and the body is what was typed', async () => {
    await open();
    await press('Add a team');
    expect(field<HTMLInputElement>('team-size').value).toBe('4');
    expect([...field('team-seats').querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'Fighter 1',
      'Fighter 2',
      'Fighter 3',
      'Fighter 4',
    ]);
    await fill('team-name', '  Paris Steel ');
    await act(async () => type(field<HTMLSelectElement>('team-color'), 'green'));
    await fill('team-seed', '2');
    await press('Add', dialog()!);

    expect(sent).toEqual([
      {
        method: 'POST',
        path: TEAMS,
        body: { name: 'Paris Steel', size: 4, color: 'green', seed: 2 },
      },
    ]);
    expect(dialog()).toBeNull();
    expect(body().textContent).toContain('Team created.');
  });

  it('a create with no size and no colour leaves both out, for the Tournament default', async () => {
    await open();
    await press('Add a team');
    await fill('team-size', '');
    await fill('team-name', 'Paris Steel');
    await press('Add', dialog()!);
    expect(sent[0]!.body).toEqual({ name: 'Paris Steel' });
  });

  it('saves a team: every field, a cleared colour and seed sent as null', async () => {
    await open();
    await press('Edit');
    expect(field<HTMLInputElement>('team-size').value).toBe('3');
    expect(field('team-seats').querySelectorAll('li')).toHaveLength(3);
    await fill('team-name', 'Lyon Blades II');
    await act(async () => type(field<HTMLSelectElement>('team-color'), ''));
    await fill('team-seed', '');
    await press('Save', dialog()!);

    expect(sent).toEqual([
      {
        method: 'PATCH',
        path: `${TEAMS}/team-1`,
        body: { name: 'Lyon Blades II', size: 3, color: null, seed: null },
      },
    ]);
    expect(body().textContent).toContain('Team saved.');
  });

  it('deletes a team once the organiser says yes, and not on Cancel', async () => {
    await open();
    await press('Delete');
    expect(dialog()?.textContent).toContain('Delete Lyon Blades?');
    await press('Cancel', dialog()!);
    expect(sent).toEqual([]);
    await press('Delete');
    await press('Delete team', dialog()!);
    expect(sent).toEqual([{ method: 'DELETE', path: `${TEAMS}/team-1`, body: undefined }]);
    expect(body().textContent).toContain('Team deleted.');
  });

  it('uploads a team logo as a file, and removes it with a null', async () => {
    await open();
    await press('Edit');
    const file = new File(['x'], 'lyon.png', { type: 'image/png' });
    const picker = field<HTMLInputElement>('team-logo-file');
    Object.defineProperty(picker, 'files', { value: [file], configurable: true });
    await act(async () => picker.dispatchEvent(new Event('change', { bubbles: true })));
    await page.settle();
    expect(sent[0]!.method).toBe('POST');
    expect(sent[0]!.path).toBe(`${TEAMS}/team-1/logo`);
    expect((sent[0]!.body as FormData).get('file')).toBe(file);

    await press('Remove', dialog()!);
    expect(sent[1]).toEqual({ method: 'PATCH', path: `${TEAMS}/team-1`, body: { logoUrl: null } });
  });

  it('refuses a logo that is not a picture before sending it, in words', async () => {
    await open();
    await press('Edit');
    const picker = field<HTMLInputElement>('team-logo-file');
    const file = new File(['x'], 'lyon.gif', { type: 'image/gif' });
    Object.defineProperty(picker, 'files', { value: [file], configurable: true });
    await act(async () => picker.dispatchEvent(new Event('change', { bubbles: true })));
    await page.settle();
    expect(sent).toEqual([]);
    expect(dialog()?.textContent).toContain('Logo must be a PNG, JPEG, or WebP image.');
  });

  it.each([
    ['tournament_full', 'This tournament has its maximum number of teams.'],
    ['team_name_taken', 'Another team of this tournament has this name.'],
    ['team_size_locked', 'A bout of this team has started, so its size cannot change.'],
    [
      'team_in_bouts',
      'A bout or the bracket names this team. Remove the team from its Pool and the bracket first.',
    ],
    ['entrant_kind_mismatch', 'This tournament takes individual fighters, not teams.'],
  ])('says the 409 %s in words, in the dialog', async (reason, sentence) => {
    await open(READS, refused(409, 'CONFLICT', { reason }));
    await press('Edit');
    await press('Save', dialog()!);
    expect(dialog()?.textContent).toContain(sentence);
    expect(body().textContent).not.toContain('An English reason');
  });

  it('says the 400 team_size_required in words', async () => {
    await open(READS, refused(400, 'team_size_required', null));
    await press('Add a team');
    await fill('team-name', 'Paris Steel');
    await press('Add', dialog()!);
    expect(dialog()?.textContent).toContain(
      'This tournament has no default team size: give the team a size.',
    );
  });

  it('says a refused delete in words on the page', async () => {
    await open(READS, refused(409, 'CONFLICT', { reason: 'team_in_bouts' }));
    await press('Delete');
    await press('Delete team', dialog()!);
    expect(body().textContent).toContain(
      'A bout or the bracket names this team. Remove the team from its Pool and the bracket first.',
    );
  });

  it('says a team Tournament has no team yet', async () => {
    await open({ ...READS, [TEAMS]: [] });
    expect(body().textContent).toContain('No team yet.');
    expect(body().querySelector('[data-testid="team-row"]')).toBeNull();
  });

  it('offers no write on an archived Event, whose server refuses them all', async () => {
    await open({ ...READS, [EVENTS_READ]: [{ id: EVENT_ID, name: 'Open', status: 'archived' }] });
    expect(body().querySelectorAll('[data-testid="team-row"]')).toHaveLength(1);
    const labels = [...body().querySelectorAll('button')].map((b) => b.textContent);
    expect(labels).not.toContain('Add a team');
    expect(labels).not.toContain('Edit');
    expect(labels).not.toContain('Delete');
  });

  it('says so when the Event has no team Tournament', async () => {
    await open({
      ...READS,
      [`/api/v1/events/${EVENT_ID}/tournaments`]: [
        { id: 't-1', name: 'Longsword', status: 'draft', entrant_kind: 'individual' },
      ],
    });
    expect(body().textContent).toContain('This event has no team tournament.');
    expect(body().querySelector('[data-testid="team-row"]')).toBeNull();
  });
});
