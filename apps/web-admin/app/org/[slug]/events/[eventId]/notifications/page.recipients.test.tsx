import { act, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { EVENT_ID, openEventPage, type, type OpenedPage } from '../archived-page.fixtures';
import EventNotificationsPage from './page';

/**
 * O5 (ruled 2026-10-14): messaging one club or one Pool took one click per person. "Select all
 * shown" adds the people the search shows; "Clear" empties; the count holds the hidden ones;
 * the search ignores accents; each row shows its club; above 500 the page says so and sends
 * nothing.
 */
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'club', eventId: 'ev1' }),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/org/club/events/ev1/notifications',
  useSearchParams: () => new URLSearchParams({ targetType: 'specific_persons' }),
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

const person = (id: string, givenName: string, clubLabel: string | null) => ({
  id,
  givenName,
  familyName: 'Roux',
  email: `${id}@example.org`,
  clubLabel,
});
const PEOPLE = [
  person('p-1', 'Léa', 'Lyon Escrime'),
  person('p-2', 'Tom', 'Lyon Escrime'),
  person('p-3', 'Ana', 'Salle Dijon'),
];
const readsWith = (people: unknown[]) => ({
  [`/api/v1/events/${EVENT_ID}`]: { id: EVENT_ID, name: 'Open 2026', status: 'running' },
  [`/api/v1/events/${EVENT_ID}/persons`]: people,
  [`/api/v1/events/${EVENT_ID}/notifications/broadcasts`]: [],
});
const SEND = `POST /api/v1/events/${EVENT_ID}/notifications/broadcast`;

let page: OpenedPage;
afterEach(() => page.unmount());

const search = () => document.body.querySelector<HTMLInputElement>('input[type="search"]')!;
const picked = () => document.body.querySelector('[role="status"]')?.textContent;
const boxes = () => [...document.body.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
async function press(label: string) {
  const button = [...document.body.querySelectorAll('button')].find((b) => b.textContent === label);
  if (!button) throw new Error(`no button "${label}"`);
  await act(async () => button.click());
  await page.settle();
}
async function open(people: unknown[] = PEOPLE) {
  page = await openEventPage(<EventNotificationsPage />, readsWith(people), {
    [SEND]: { recipientCount: 1 },
  });
}

describe('the people picker of a broadcast', () => {
  it('finds a person whatever the accents, and shows each club', async () => {
    await open();
    act(() => type(search(), 'lea'));
    expect(document.body.textContent).toContain('Léa Roux');
    expect(document.body.textContent).not.toContain('Tom Roux');
    expect(boxes()[0]!.closest('label')?.textContent).toContain('Lyon Escrime');
  });

  it('adds the people shown to an earlier pick, and counts the ones the search hides', async () => {
    await open();
    act(() => type(search(), 'dijon'));
    await act(async () => boxes()[0]!.click());
    act(() => type(search(), 'lyon'));
    await press('Select all shown');
    expect(picked()).toBe('3 picked, 1 of them hidden by the search');
    await press('Clear');
    expect(picked()).toBe('0 picked');
  });

  it('sends nothing while nobody is picked, and sends once someone is', async () => {
    await open();
    act(() => {
      type(document.body.querySelector<HTMLInputElement>('input[maxlength="120"]')!, 'Lunch');
      type(document.body.querySelector('textarea')!, 'Back at 14:00.');
    });
    const send = () =>
      [...document.body.querySelectorAll('button')].find(
        (b) => b.textContent === 'Send notification',
      )!;
    expect(picked()).toBe('0 picked');
    expect(send().disabled).toBe(true);

    await act(async () => boxes()[0]!.click());
    expect(send().disabled).toBe(false);
  });

  it('says so above 500 people, and sends nothing', async () => {
    const crowd = Array.from({ length: 501 }, (_, i) => person(`p-${i}`, `Fighter${i}`, null));
    await open(crowd);
    act(() => {
      type(document.body.querySelector<HTMLInputElement>('input[maxlength="120"]')!, 'Lunch');
      type(document.body.querySelector('textarea')!, 'Back at 14:00.');
    });
    await press('Select all shown');
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe(
      'A message goes to 500 people at most: 501 are picked.',
    );
    const send = [...document.body.querySelectorAll('button')].find(
      (b) => b.textContent === 'Send notification',
    )!;
    expect(send.disabled).toBe(true);
    expect(vi.mocked(apiRequest).mock.calls.some(([, , init]) => init?.method === 'POST')).toBe(
      false,
    );
  });
});
