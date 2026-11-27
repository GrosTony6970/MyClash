import { act, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import {
  openArchivedPage,
  openEventPage,
  refused,
  type,
  type OpenedPage,
} from '../archived-page.fixtures';
import EventChatPage from './page';

/**
 * The AI chat of an Event (rulings 377, 378). On an archived Event nothing is
 * sent, renamed, deleted, confirmed or rejected: the server refuses all of it.
 * And a send the server refuses says the server's reason, not one fixed sentence; a proposal
 * already closed says so in words.
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
        readable: [{ kind: 'unsupported' }],
        validationState: { ok: true },
        applyStarted: false,
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

describe('a proposal closed in another tab (ruling 994)', () => {
  it.each([
    ['Confirm & apply', 'confirm'],
    ['Dismiss', 'reject'],
  ])('%s says so in words, and the card shows where it stands', async (name, decision) => {
    // The other tab applied it: the conversation, read again, says so.
    let closedElsewhere = false;
    const applied = structuredClone(CONVERSATION);
    applied.messages[0]!.proposal.status = 'applied';
    const conversation = () => (closedElsewhere ? applied : CONVERSATION);
    const closed = {
      ok: false as const,
      kind: 'http' as const,
      status: 409,
      detail: 'This draft is already applied.',
      validationErrors: null,
      code: 'draft_closed',
      details: null,
    };
    page = await openEventPage(
      <EventChatPage />,
      {
        '/api/v1/events/ev1': { id: 'ev1', name: 'Open 2026', status: 'running' },
        ...READS,
        '/api/v1/events/ev1/chat/conversations/c-1': conversation,
      },
      {
        [`POST /api/v1/events/ev1/chat/conversations/c-1/proposals/d-1/${decision}`]:
          refused(closed),
      },
    );
    closedElsewhere = true;
    const button = [...document.body.querySelectorAll('button')].find(
      (b) => b.textContent === name,
    );

    await act(async () => button!.click());
    await page.settle();

    expect(document.body.textContent).toContain('This draft is already applied, partly applied');
    expect(document.body.textContent).not.toContain('This draft is already applied.');
    expect(document.body.textContent).toContain('Applied');
    const live = [...document.body.querySelectorAll('button')].map((b) => b.textContent);
    expect(live).not.toContain('Confirm & apply');
    expect(live).not.toContain('Dismiss');
  });
});

describe('a Confirm the server refuses for any reason', () => {
  it('reads the conversation again, so a draft its Apply closed keeps no live Confirm', async () => {
    // The Apply started, then stopped at its write: the draft is closed, and the card says so.
    let stopped = false;
    const closed = structuredClone(CONVERSATION);
    Object.assign(closed.messages[0]!.proposal, { status: 'failed', applyStarted: true });
    const refusal = {
      ok: false as const,
      kind: 'http' as const,
      status: 400,
      detail: 'Partially applied 0/1 action(s) before failing',
      validationErrors: null,
      code: 'bad_request',
      details: null,
    };
    page = await openEventPage(
      <EventChatPage />,
      {
        '/api/v1/events/ev1': { id: 'ev1', name: 'Open 2026', status: 'running' },
        ...READS,
        '/api/v1/events/ev1/chat/conversations/c-1': () => (stopped ? closed : CONVERSATION),
      },
      { 'POST /api/v1/events/ev1/chat/conversations/c-1/proposals/d-1/confirm': refused(refusal) },
    );
    stopped = true;
    const live = () => [...document.body.querySelectorAll('button')].map((b) => b.textContent);
    expect(live()).toContain('Confirm & apply');

    await act(async () =>
      [...document.body.querySelectorAll('button')]
        .find((b) => b.textContent === 'Confirm & apply')!
        .click(),
    );
    await page.settle();

    expect(live()).not.toContain('Confirm & apply');
    expect(live()).not.toContain('Dismiss');
  });
});

describe('a proposal whose schedule collides at Apply', () => {
  it('says so in words, never the bout id the API names', async () => {
    const busy = {
      ok: false as const,
      kind: 'http' as const,
      status: 409,
      detail: 'Piste already busy: this bout overlaps match 0b9c5a52-1d2e-4f3a-8b4c-5d6e7f8a9b0c',
      validationErrors: null,
      code: 'schedule_collision',
      details: null,
    };
    page = await openEventPage(
      <EventChatPage />,
      { '/api/v1/events/ev1': { id: 'ev1', name: 'Open 2026', status: 'running' }, ...READS },
      { 'POST /api/v1/events/ev1/chat/conversations/c-1/proposals/d-1/confirm': refused(busy) },
    );
    const confirm = [...document.body.querySelectorAll('button')].find(
      (b) => b.textContent === 'Confirm & apply',
    );

    await act(async () => confirm!.click());
    await page.settle();

    expect(document.body.textContent).toContain(
      'A bout in this draft overlaps another bout on its piste. Nothing was moved.',
    );
    expect(document.body.textContent).not.toContain('0b9c5a52');
  });
});
