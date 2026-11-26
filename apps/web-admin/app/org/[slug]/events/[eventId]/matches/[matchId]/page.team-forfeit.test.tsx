import type { ReactNode } from 'react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import { apiRequest } from '@myclash/api-client';
import { openEventPage, type OpenedPage } from '../../archived-page.fixtures';
import { BOUT, boutReads } from './page.fixtures';
import MatchDetailPage from './page';

/**
 * Lyon Blades meets Paris Fencers in a team Pool. Paris's last fencer is hurt and Paris gives the
 * bout up. The organiser opens the bout page, picks Paris and "Injury", and records it. A team
 * bout names no Registration, so the forfeit names the team (`forfeitingTeamId`, call 8), and a
 * team has no Fighter status, so the form asks no "can continue?" and sends no answer (call 4).
 */
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'org', eventId: 'ev1', matchId: 'm1' }),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/org/org/events/ev1/matches/m1',
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

const RUNNING_EVENT = { '/api/v1/events/ev1': { id: 'ev1', name: 'Open 2025', status: 'running' } };
const TEAM_SIDES = {
  red_registration_id: null,
  blue_registration_id: null,
  red_team_id: 'team-lyon',
  blue_team_id: 'team-paris',
};
const RUNNING_TEAM_BOUT = { ...BOUT, ...TEAM_SIDES, status: 'running', locked_at: null };
const ENDED_TEAM_BOUT = { ...BOUT, ...TEAM_SIDES, locked_at: null };
const RUNNING_BOUT = { ...BOUT, status: 'running', locked_at: null };
const FORFEIT = 'POST /api/v1/matches/m1/forfeit';

/** A select of the form, found by one of its values, set the way a change sets it. */
async function pick(value: string) {
  const select = [...document.querySelectorAll('select')].find((field) =>
    [...field.options].some((option) => option.value === value),
  )!;
  select.value = value;
  await act(async () => select.dispatchEvent(new Event('change', { bubbles: true })));
}

/** Presses the form's own button: the one that says what it records. */
async function record(label: string) {
  const button = [...document.querySelectorAll('section button')].find(
    (each) => each.textContent === label,
  ) as HTMLButtonElement;
  await act(async () => button.click());
  await page.settle();
}

/** The body of the one forfeit the page sent. */
function forfeitBody(): Record<string, unknown> {
  const sends = vi
    .mocked(apiRequest)
    .mock.calls.filter(([, path, init]) => path === '/api/v1/matches/m1/forfeit' && init?.method);
  expect(sends).toHaveLength(1);
  return sends[0]![2]!.body as Record<string, unknown>;
}

const asksCanContinue = () => document.body.textContent?.includes('Can continue') ?? false;

let page: OpenedPage;
afterEach(() => page.unmount());

describe('the bout page forfeits a team by side', () => {
  it('sends the team of the side it names, and no "can continue?"', async () => {
    page = await openEventPage(
      <MatchDetailPage />,
      { ...RUNNING_EVENT, ...boutReads(RUNNING_TEAM_BOUT, null) },
      { [FORFEIT]: {} },
    );

    await pick('blue');
    await pick('injury');
    expect(asksCanContinue()).toBe(false);
    await record('Record forfeit');

    const body = forfeitBody();
    expect(body).toMatchObject({ forfeitingTeamId: 'team-paris', reason: 'injury' });
    expect(body).not.toHaveProperty('forfeitingRegistrationId');
    expect(body.canContinue).toBeUndefined();
  });

  it('sends the team of the side it names on an override of an ended bout', async () => {
    page = await openEventPage(
      <MatchDetailPage />,
      { ...RUNNING_EVENT, ...boutReads(ENDED_TEAM_BOUT, null) },
      { [FORFEIT]: {} },
    );

    await record('Override result');

    const body = forfeitBody();
    expect(body).toMatchObject({
      forfeitingTeamId: 'team-lyon',
      explicitScores: { forfeitingScore: 5, opponentScore: 3 },
    });
    expect(body).not.toHaveProperty('forfeitingRegistrationId');
    expect(body.canContinue).toBeUndefined();
  });

  it("still sends a Fighter's Registration and asks for a Fighter", async () => {
    page = await openEventPage(
      <MatchDetailPage />,
      { ...RUNNING_EVENT, ...boutReads(RUNNING_BOUT, null) },
      { [FORFEIT]: {} },
    );

    await pick('blue');
    await pick('injury');
    expect(asksCanContinue()).toBe(true);
    await record('Record forfeit');

    const body = forfeitBody();
    expect(body).toMatchObject({
      forfeitingRegistrationId: 'reg-blue',
      reason: 'injury',
      canContinue: true,
    });
    expect(body).not.toHaveProperty('forfeitingTeamId');
  });
});

describe('the forfeit reasons name the kind of side', () => {
  const groups = () => [...document.querySelectorAll('optgroup')].map((group) => group.label);

  it('say a team stopped fighting on a team bout', async () => {
    page = await openEventPage(<MatchDetailPage />, {
      ...RUNNING_EVENT,
      ...boutReads(RUNNING_TEAM_BOUT, null),
    });

    expect(groups()).toContain('Forfeit — a team stopped fighting');
    expect(groups()).not.toContain('Forfeit — a fighter stopped fighting');
  });

  it('say a fighter stopped fighting on a Fighters’ bout', async () => {
    page = await openEventPage(<MatchDetailPage />, {
      ...RUNNING_EVENT,
      ...boutReads(RUNNING_BOUT, null),
    });

    expect(groups()).toContain('Forfeit — a fighter stopped fighting');
    expect(groups()).not.toContain('Forfeit — a team stopped fighting');
  });
});
