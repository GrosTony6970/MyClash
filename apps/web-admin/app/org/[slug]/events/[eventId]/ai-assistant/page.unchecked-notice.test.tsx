import { act, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import { openEventPage, type OpenedPage } from '../archived-page.fixtures';
import EventAIAssistantPage from './page';

/**
 * The assistant's referee drafts carry the rule-8 notice (CLAUDE.md rule 8; ADR-016, 2026-11-13;
 * design decision 11). A team's slots have no names in slice 1b-1, so the one checker cannot see a
 * team's Fighters. The server marks a draft of a team Pool or bout with `uncheckedFighters`, the
 * flag the referee board uses, and the opened draft says so. The note blocks nothing.
 */
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'club', eventId: 'ev1' }),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/org/club/events/ev1/ai-assistant',
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

const NOTICE = 'MyClash cannot check these Fighters: this team has Fighters with no name';

const refereeDraft = (id: string, summary: string, uncheckedFighters?: true) => ({
  id,
  tournamentId: 't-1',
  draftType: 'referee_assignments',
  prompt: 'Staff Pool A',
  summary,
  proposedActions: [{ kind: 'assign_referee', userId: 'p-1', role: 'referee', poolId: 'pool-1' }],
  validationState: { ok: true },
  status: 'ready',
  error: null,
  ...(uncheckedFighters ? { uncheckedFighters } : {}),
});

const READS = {
  '/api/v1/events/ev1': { id: 'ev1', name: 'Open 2026', status: 'published' },
  '/api/v1/organizations/org-1/ai-settings': { provider: 'anthropic' },
  '/api/v1/events/ev1/tournaments': [{ id: 't-1', name: 'Team Longsword' }],
  '/api/v1/events/ev1/ai-assistant/drafts': [
    refereeDraft('d-team', 'Referees for the team Pool', true),
    refereeDraft('d-solo', 'Referees for the Fighters Pool'),
  ],
};

let page: OpenedPage;
afterEach(() => page.unmount());

/** Opens the draft whose history entry is the `index`th, as the organiser does. */
async function openDraft(index: number) {
  const entries = [...document.body.querySelectorAll('aside button')];
  await act(async () => (entries[index] as HTMLButtonElement).click());
}

const note = () => document.body.querySelector('[role="note"]');

describe('a referee draft of the AI assistant', () => {
  it('says MyClash cannot check the Fighters of a team Pool', async () => {
    page = await openEventPage(<EventAIAssistantPage />, READS);

    await openDraft(0);

    expect(document.body.textContent).toContain('Referees for the team Pool');
    expect(note()?.textContent).toBe(NOTICE);
  });

  it('says nothing of the kind on a draft of a Pool of Fighters', async () => {
    page = await openEventPage(<EventAIAssistantPage />, READS);

    await openDraft(1);

    expect(document.body.textContent).toContain('Referees for the Fighters Pool');
    expect(note()).toBeNull();
  });
});
