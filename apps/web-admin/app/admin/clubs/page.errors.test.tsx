import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import { apiRequest } from '@myclash/api-client';
import { ToastProvider } from '@myclash/ui';
import { I18nProvider } from '@/i18n/I18nProvider';
import AdminClubsPage from './page';

/**
 * The clubs console makes two reads on load: the club list and the pending club
 * requests. They once shared one error message, so a requests read that
 * succeeded AFTER a failed list cleared the list's reason, and the screen said
 * "No clubs found." over a list that never loaded (found by prod E2E spec 37).
 */
vi.mock('next/navigation', () => ({
  useParams: () => ({}),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/admin/clubs',
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

const LIST_REASON = 'Club records are locked while a merge finishes. Try again in a minute.';
const REQUESTS_REASON = 'The review queue is being rebuilt.';

const refused = (detail: string) => ({
  ok: false as const,
  kind: 'http' as const,
  status: 409,
  detail,
  validationErrors: null,
  code: null,
  details: null,
});

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

/**
 * Opens the page. The club list answers at once; the requests read answers only
 * when the test releases it, so the test decides which read lands last.
 */
async function open(list: unknown, requests: unknown): Promise<() => Promise<void>> {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let release: () => void = () => undefined;
  const requestsAnswered = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.mocked(apiRequest).mockImplementation(async (_base: string, path: string) => {
    if (path.startsWith('/api/v1/clubs/review-requests')) {
      await requestsAnswered;
      return requests as never;
    }
    if (path.startsWith('/api/v1/clubs?')) return list as never;
    throw new Error(`unexpected read ${path}`);
  });
  const container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <I18nProvider locale="en">
        <ToastProvider>
          <AdminClubsPage />
        </ToastProvider>
      </I18nProvider>,
    );
  });
  return async () => {
    await act(async () => {
      release();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };
}

const text = () => document.body.textContent ?? '';

describe('the clubs console when a read is refused', () => {
  it("keeps the club list's reason when the requests read succeeds after it", async () => {
    const answerRequests = await open(refused(LIST_REASON), { ok: true, data: [] });
    expect(text()).toContain(LIST_REASON);

    await answerRequests();

    expect(text(), 'a later, successful requests read must not erase it').toContain(LIST_REASON);
  });

  it('says why the requests read failed, beside the list it did not touch', async () => {
    const answerRequests = await open({ ok: true, data: [] }, refused(REQUESTS_REASON));

    await answerRequests();

    expect(text()).toContain(REQUESTS_REASON);
  });
});
