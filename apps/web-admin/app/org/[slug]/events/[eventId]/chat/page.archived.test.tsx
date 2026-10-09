import { act, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import { openArchivedPage, openEventPage, type, type OpenedPage } from '../archived-page.fixtures';
import EventChatPage from './page';

/**
 * The AI chat of an Event (rulings 377, 378). On an archived Event nothing is
 * sent, renamed, deleted, confirmed or rejected: the server refuses all of it.
 * And a send the server refuses says the server's reason, not one fixed sentence.
 */
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'org', eventId: 'ev1' }),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/org/org/events/ev1/chat',
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

const CONVERSATION = {
  id: 'c-1',
  eventId: 'ev1',
  tournamentId: null,
  title: 'Pools',
  messages: [
    {
      id: 'msg-1',
      role: 'assistant',
      content: 'Two pools of six.',
      toolCalls: [],
      proposal: {
        id: 'd-1',
        draftType: 'pool_plan',
        status: 'ready',
        summary: 'Two pools',
        proposedActions: [{ kind: 'set_pools', count: 2 }],
        validationState: { ok: true },
      },
    },
  ],
};

const READS = {
  '/api/v1/organizations/slug/org': { id: 'org-1' },
  '/api/v1/organizations/org-1/ai-settings': { provider: 'anthropic' },
  '/api/v1/events/ev1/chat/conversations': [{ id: 'c-1', title: 'Pools' }],
  '/api/v1/events/ev1/chat/conversations/c-1': CONVERSATION,
};

let page: OpenedPage;
afterEach(() => page.unmount());

describe('the AI chat of an archived Event', () => {
  it('sends, renames, deletes, confirms and rejects nothing', async () => {
    page = await openArchivedPage(<EventChatPage />, READS);
    expect(document.body.textContent).toContain('Two pools of six.');

    await page.pressEverything();

    expect(page.writes()).toEqual([]);
  });

  it('closes the rename, the message box and Send, each on its own', async () => {
    page = await openArchivedPage(<EventChatPage />, READS);
    const rename = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="Rename conversation"]',
    );
    const box = document.body.querySelector<HTMLTextAreaElement>('textarea');
    expect(rename?.disabled).toBe(true);
    expect(box?.disabled).toBe(true);

    // A message typed before the Event's status was read: Send stays closed over it.
    await act(async () => type(box!, 'Add a third pool'));
    const send = [...document.body.querySelectorAll('button')].find(
      (b) => b.textContent === 'Send',
    );
    expect(box?.value).toBe('Add a third pool');
    expect(send?.disabled).toBe(true);
  });
});

describe('a send the server refuses', () => {
  it('says the server’s reason', async () => {
    // The Event archived itself while the page was open: the page still reads "running".
    page = await openEventPage(<EventChatPage />, {
      '/api/v1/events/ev1': { id: 'ev1', name: 'Open 2025', status: 'running' },
      ...READS,
    });
    const box = document.body.querySelector<HTMLTextAreaElement>('textarea');
    await act(async () => type(box!, 'Add a third pool'));
    const send = [...document.body.querySelectorAll('button')].find(
      (b) => b.textContent === 'Send',
    );

    await act(async () => send!.click());
    await page.settle();

    expect(page.writes()).toEqual([
      'POST /api/v1/events/ev1/chat/conversations/c-1/messages/stream',
    ]);
    expect(document.body.textContent).toContain('This event is archived');
    expect(document.body.textContent).not.toContain('Could not send');
  });
});
