import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@myclash/ui';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { I18nProvider } from '@/i18n/I18nProvider';
import TournamentsPage from './page';

/**
 * The Tournaments of an archived Event still offer their League link (ruling
 * 224): a League link writes League rows only, so the server takes it on an
 * Event that archived itself the day after its last bout.
 */
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'org', eventId: 'ev1' }),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/org/org/events/ev1/tournaments',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('@/components/organizer-event-context', () => ({
  useOrganizerSelectedEvent: () => ({ events: [{ id: 'ev1', status: 'archived' }] }),
}));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));
// The panel's own reads are not this test's subject: it is found or it is not.
vi.mock('./_components/AttachToLeaguePanel', () => ({
  AttachToLeaguePanel: () => <section data-testid="league-panel" />,
}));

const READS: Record<string, unknown> = {
  '/api/v1/events/ev1': { name: 'Open 2025', status: 'published' },
  '/api/v1/events/ev1/tournaments': [
    { id: 't-1', slug: 'longsword', name: 'Longsword', status: 'completed' },
  ],
};

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.mocked(apiRequest).mockReset();
  vi.mocked(apiRequest).mockImplementation(async (_base: string, path: string) => {
    if (path in READS) return { ok: true, data: READS[path] };
    throw new Error(`unexpected request ${path}`);
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <I18nProvider locale="en">
        <ToastProvider>
          <TournamentsPage />
        </ToastProvider>
      </I18nProvider>,
    );
  });
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('the Tournaments of an archived Event', () => {
  it('still show the panel that links them to a League', () => {
    expect(document.body.querySelector('[data-testid="league-panel"]')).not.toBeNull();
  });
});
