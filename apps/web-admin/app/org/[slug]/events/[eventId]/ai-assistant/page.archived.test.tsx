import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import { openArchivedPage, type OpenedPage } from '../archived-page.fixtures';
import EventAIAssistantPage from './page';

/**
 * The AI assistant of an archived Event (ruling 377): a draft is not made,
 * saved, applied or rejected there. The server refuses all four.
 */
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'org', eventId: 'ev1' }),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/org/org/events/ev1/ai-assistant',
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

const READY_DRAFT = {
  id: 'd-1',
  tournamentId: null,
  draftType: 'tournament_config',
  prompt: 'Two pools of six',
  summary: 'Two pools',
  proposedActions: [{ kind: 'set_pools', count: 2 }],
  validationState: { ok: true },
  status: 'ready',
  error: null,
};

const READS = {
  '/api/v1/organizations/slug/org': { id: 'org-1' },
  '/api/v1/organizations/org-1/ai-settings': { provider: 'anthropic' },
  '/api/v1/events/ev1/tournaments': [{ id: 't-1', name: 'Longsword' }],
  '/api/v1/events/ev1/ai-assistant/drafts': [READY_DRAFT],
};

let page: OpenedPage;
afterEach(() => page.unmount());

describe('the AI assistant of an archived Event', () => {
  it('makes, saves, applies and rejects no draft', async () => {
    page = await openArchivedPage(<EventAIAssistantPage />, READS);

    await page.pressEverything();

    expect(page.writes()).toEqual([]);
  });
});
