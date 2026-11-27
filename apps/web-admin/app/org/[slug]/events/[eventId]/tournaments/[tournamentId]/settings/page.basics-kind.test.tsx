import { act, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as ApiClient from '@myclash/api-client';
import { EVENTS_READ, type } from '../../../archived-page.fixtures';
import { button } from './page.fixtures';
import { openTab, type OpenedTab } from './page.rules.fixtures';

/**
 * The settings Basics tab shows a Tournament's kind of entrant (Team Tournaments, slice 1b-1). A
 * team Tournament has no waitlist and takes no forfeit rules: the tab hides both and its Save does
 * not send them. Once the Tournament holds an entrant the kind is fixed, said, and not sent.
 */
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'org', eventId: 'ev1', tournamentId: 't-1' }),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/org/org/events/ev1/tournaments/t-1/settings',
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

let opened: OpenedTab;
afterEach(() => opened.page.unmount());

/** A team Tournament with no entrant yet: 8 teams of 3 at most. */
const TEAM = {
  entrant_kind: 'team',
  team_default_size: 3,
  max_participants: 8,
  max_waitlist: null,
  entrant_count: 0,
};

const q = <T extends Element>(selector: string) => document.body.querySelector<T>(selector);
const radio = (kind: string) => q<HTMLInputElement>(`input[name="entrant-kind"][value="${kind}"]`)!;
const field = (label: string) => q<HTMLInputElement>(`input[aria-label="${label}"]`);
const forfeitBlock = () => q('[data-testid="forfeit-injury-score"]');
/** How many times the page read the club's Event list, which the menu's Teams entry follows. */
const eventListReads = () =>
  vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith(EVENTS_READ)).length;

async function save() {
  await act(async () => button('Save changes').click());
  await opened.page.settle();
}

describe('the kind of entrant in the settings Basics tab', () => {
  it('an individual Tournament sends the body it always did: no kind, no team size', async () => {
    opened = await openTab('basics');
    const before = eventListReads();
    expect(radio('individual').checked).toBe(true);
    expect(field('Max participants')).not.toBeNull();
    expect(field('Max waitlist')).not.toBeNull();
    expect(forfeitBlock()).not.toBeNull();
    await save();

    expect(opened.saved).toEqual([
      {
        name: 'Longsword',
        weapon: 'Longsword',
        penaltyRulesetId: 'pr-1',
        maxParticipants: null,
        maxWaitlist: null,
      },
    ]);
    // The kind did not change: the menu has nothing to read again.
    expect(eventListReads()).toBe(before);
  });

  it('a team Tournament hides the waitlist and the forfeit rules, and sends neither nor its kind', async () => {
    opened = await openTab('basics', { row: TEAM });
    expect(radio('team').checked).toBe(true);
    expect(field('Max teams')!.value).toBe('8');
    expect(field('Max waitlist')).toBeNull();
    expect(forfeitBlock()).toBeNull();
    expect(q<HTMLInputElement>('[data-testid="team-default-size"]')!.value).toBe('3');
    await act(async () => type(q<HTMLInputElement>('[data-testid="team-default-size"]')!, '4'));
    await save();

    expect(opened.saved).toEqual([
      {
        name: 'Longsword',
        weapon: 'Longsword',
        penaltyRulesetId: 'pr-1',
        maxParticipants: 8,
        teamDefaultSize: 4,
      },
    ]);
  });

  it('a switch to team sends the team body, and the menu reads the Event list again', async () => {
    opened = await openTab('basics');
    const before = eventListReads();
    await act(async () => radio('team').click());
    await save();

    expect(opened.saved).toEqual([
      {
        name: 'Longsword',
        weapon: 'Longsword',
        penaltyRulesetId: 'pr-1',
        maxParticipants: null,
        entrantKind: 'team',
        teamDefaultSize: null,
      },
    ]);
    expect(eventListReads()).toBe(before + 1);
  });

  /** The PATCH answers a 409 naming `reason`; every other request is served as before. */
  function refusePatch(reason: string) {
    const served = vi.mocked(ApiClient.apiRequest).getMockImplementation()!;
    vi.mocked(ApiClient.apiRequest).mockImplementation(async (base, path, init) =>
      init?.method === 'PATCH'
        ? ({
            ok: false,
            kind: 'http',
            status: 409,
            detail: 'An English sentence from the API.',
            code: 'CONFLICT',
            details: { reason },
            validationErrors: null,
          } as never)
        : served(base, path, init),
    );
  }

  // Ruling 981: an empty individual Tournament linked to a League by mistake, then switched to team.
  it('a switch to team under a live League link says to remove the link first', async () => {
    opened = await openTab('basics');
    refusePatch('league_link_blocks_team');
    await act(async () => radio('team').click());
    await save();

    expect(document.body.textContent).toContain(
      'Remove the League link first: League points belong to persons.',
    );
  });

  // Ruling 989: an empty individual Tournament given a double elimination bracket, then switched to
  // team. The page reads no phase, so the choice stays open and the save's refusal says why.
  it('a switch to team of a Tournament with Pools or a bracket says to delete them first', async () => {
    opened = await openTab('basics');
    refusePatch('kind_locked_by_phase');
    await act(async () => radio('team').click());
    await save();

    expect(document.body.textContent).toContain(
      'Delete the Pools and the bracket first: a tournament keeps its kind once it has Pools or a bracket.',
    );
  });

  // A Fighter registered in another tab after the page read the empty Tournament.
  it('a switch of a Tournament that gained an entrant since it was read says its kind is fixed now', async () => {
    opened = await openTab('basics');
    refusePatch('entrant_kind_settled');
    await act(async () => radio('team').click());
    await save();

    expect(document.body.textContent).toContain(
      'This tournament has entrants now, so its kind cannot change.',
    );
  });

  it('a Tournament that holds entrants shows its kind fixed, says why, and sends no kind', async () => {
    opened = await openTab('basics', { row: { ...TEAM, entrant_count: 5 } });
    expect(radio('team').disabled).toBe(true);
    expect(radio('individual').disabled).toBe(true);
    expect(document.body.textContent).toContain(
      'This tournament already has entrants, so its kind cannot change.',
    );
    await save();
    expect(opened.saved).toEqual([
      {
        name: 'Longsword',
        weapon: 'Longsword',
        penaltyRulesetId: 'pr-1',
        maxParticipants: 8,
        teamDefaultSize: 3,
      },
    ]);
  });
});
