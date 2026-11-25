import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@myclash/ui';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { I18nProvider } from '@/i18n/I18nProvider';
import PoolsPage from './page';
import type { PoolSeat } from '@myclash/types/pool-standings';
import type { PoolMemberSeat } from './pool-seats';

/**
 * Pools of teams (ruling 971). A team has no club and no rating: the generation spreads teams by
 * seed or by random draw, and sends neither the club nor the skill switch, which the API refuses
 * on a team Tournament. A team is seated by `teamId` and leaves its Pool by its side key; its row
 * names the team (`personName` is null for a team).
 */

vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'org', eventId: 'ev1' }),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('@/components/organizer-event-context', () => ({
  useOrganizerSelectedEvent: () => ({ events: [{ id: 'ev1', status: 'running' }] }),
}));
vi.mock('./_tabs/MatchesTab', () => ({ MatchesTab: () => null }));
vi.mock('./_tabs/StandingsTab', () => ({ StandingsTab: () => null }));
vi.mock('./_tabs/RefereesTab', () => ({ RefereesTab: () => null }));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

const teamSeat = (id: string, name: string): PoolSeat => ({
  sideId: id,
  kind: 'team',
  registrationId: null,
  name,
  personName: null,
  clubLabel: null,
  colour: 'red',
  logoUrl: null,
  hemaWeightedRating: null,
});
const fighterSeat = (id: string, name: string): PoolSeat => ({
  ...teamSeat(id, name),
  kind: 'individual',
  registrationId: id,
  personName: name,
  colour: null,
});

/** Each write the page sent: generate, seat and unseat. */
let sent: Array<{ path: string; method: string | undefined; body: unknown }>;

function serve(kind: 'team' | 'individual', members: PoolMemberSeat[], waiting: PoolSeat[]) {
  sent = [];
  vi.mocked(apiRequest).mockImplementation(
    async (_base: string, path: string, init?: { method?: string; body?: unknown }) => {
      if (init?.method) {
        sent.push({ path, method: init.method, body: init.body });
        return { ok: true, data: {} } as never;
      }
      if (path === '/api/v1/events/ev1/tournaments') {
        return { ok: true, data: [{ id: 't1', name: 'Team Longsword', entrant_kind: kind }] };
      }
      if (path === '/api/v1/tournaments/t1/pools') {
        const pools = members.length > 0 ? [{ id: 'p1', name: 'Pool 1', members }] : [];
        return { ok: true, data: { phaseId: members.length > 0 ? 'ph1' : null, pools } };
      }
      if (path === '/api/v1/tournaments/t1/unassigned-fighters') {
        return { ok: true, data: waiting };
      }
      if (path === '/api/v1/tournaments/t1/conflict-check') {
        return { ok: true, data: { conflicts: [] } };
      }
      throw new Error(`unexpected request ${path}`);
    },
  );
}

async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.mocked(apiRequest).mockReset();
  window.location.hash = '';
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function openPage() {
  await act(async () => {
    root.render(
      <I18nProvider locale="en">
        <ToastProvider>
          <PoolsPage />
        </ToastProvider>
      </I18nProvider>,
    );
  });
  await settle();
}

const page = () => container.textContent ?? '';
/** An entrant's chip, in a Pool or in the unassigned panel. */
const chip = (name: string) =>
  [...container.querySelectorAll('[draggable]')].find((el) => el.textContent?.includes(name))!;

async function tap(label: string) {
  const button = [...container.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  expect(button, `no button named ${label}`).toBeDefined();
  await act(async () => button!.click());
  await settle();
}

async function fire(element: Element, type: 'dragstart' | 'drop' | 'dragover') {
  await act(async () => {
    element.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
  });
  await settle();
}

const generateBodies = () =>
  sent.filter((call) => call.path.includes('generate-pools')).map((call) => call.body);

describe('Pools page: a team Tournament', () => {
  it('spreads teams by seed, and sends no club or skill switch', async () => {
    serve('team', [], [teamSeat('team-lyon', 'Lyon Blades')]);
    await openPage();

    expect(page()).toContain('Spread teams');
    expect(page()).not.toContain('School separation');
    expect(page()).not.toContain('Skill balance');

    await tap('Generate pools');
    expect(generateBodies()).toEqual([{ teamSpread: 'seed', targetSize: 8 }]);
  });

  it('says empty Pools wait for teams, not fighters', async () => {
    serve('team', [], []);
    await openPage();
    expect(page()).toContain('Will generate 1 empty pool — add teams later.');
    expect(page()).not.toContain('add fighters later');
  });

  it('sends the random draw when the organiser picks it', async () => {
    serve('team', [], [teamSeat('team-lyon', 'Lyon Blades')]);
    await openPage();

    const random = [...container.querySelectorAll('label')].find(
      (label) => label.textContent?.trim() === 'Random draw',
    );
    await act(async () => random!.querySelector('input')!.click());
    await tap('Generate pools');
    expect(generateBodies()).toEqual([{ teamSpread: 'random', targetSize: 8 }]);
  });

  it('lists the waiting teams by name, and seats one by its team id', async () => {
    serve(
      'team',
      [{ ...teamSeat('team-paris', 'Paris Rapiers'), seed: 1 }],
      [teamSeat('team-lyon', 'Lyon Blades')],
    );
    await openPage();

    expect(page()).toContain('Lyon Blades');
    expect(page()).toContain('1 team');
    // A drop on a seated chip bubbles to its Pool card.
    await fire(chip('Lyon Blades'), 'dragstart');
    await fire(chip('Paris Rapiers'), 'drop');

    expect(sent).toContainEqual({
      path: '/api/v1/pools/p1/members',
      method: 'POST',
      body: { teamId: 'team-lyon' },
    });
  });

  it('takes a team out of its Pool by its side key', async () => {
    serve('team', [{ ...teamSeat('team-paris', 'Paris Rapiers'), seed: 1 }], []);
    await openPage();

    expect(page()).toContain('Paris Rapiers');
    await tap('×');
    expect(sent).toContainEqual({
      path: '/api/v1/pools/p1/members/team-paris',
      method: 'DELETE',
      body: undefined,
    });
  });
});

describe('Pools page: an individual Tournament is unchanged', () => {
  it('says empty Pools wait for fighters', async () => {
    serve('individual', [], []);
    await openPage();
    expect(page()).toContain('Will generate 1 empty pool — add fighters later.');
  });

  it('sends the club and skill switches and no team spread', async () => {
    serve('individual', [], [fighterSeat('reg-anna', 'Anna Roux')]);
    await openPage();

    expect(page()).not.toContain('Spread teams');
    await tap('Generate pools');
    expect(generateBodies()).toEqual([
      { enforceSchoolSeparation: true, enforceSkillBalance: true, targetSize: 8 },
    ]);
  });

  it('seats a Fighter by its Registration id', async () => {
    serve(
      'individual',
      [{ ...fighterSeat('reg-ben', 'Ben Morel'), seed: 1 }],
      [fighterSeat('reg-anna', 'Anna Roux')],
    );
    await openPage();

    // A drop on a seated chip bubbles to its Pool card.
    await fire(chip('Anna Roux'), 'dragstart');
    await fire(chip('Ben Morel'), 'drop');

    expect(sent).toContainEqual({
      path: '/api/v1/pools/p1/members',
      method: 'POST',
      body: { registrationId: 'reg-anna' },
    });
    expect(page()).toContain('1 fighter');
  });
});
