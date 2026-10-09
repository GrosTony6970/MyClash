/**
 * Where an organiser page takes its Event's status from (ruling 380).
 *
 * The public Event read answers 404 for a TEST Event, to everybody. So this file
 * answers no public read at all: a page that asks it fails the test. The status
 * comes from the club's own Event list, which holds a test Event too.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import { EVENTS_READ, EVENT_ID, openEventPage, type OpenedPage } from '../archived-page.fixtures';
import EventLayout from '../layout';
import { useEventStatus } from './useEventStatus';

vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'club', eventId: 'ev1' }),
}));
vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

const NO_REQUEST = `/api/v1/deletion-requests/active?targetType=event&targetId=${EVENT_ID}`;
const testEvent = (status: string) => ({ id: EVENT_ID, name: 'Test day', status });

function Probe() {
  const { isReadOnly, isArchived } = useEventStatus(EVENT_ID);
  return <p data-testid="probe">{`${isReadOnly}/${isArchived}`}</p>;
}
const probe = () => document.querySelector('[data-testid="probe"]')?.textContent;

let opened: OpenedPage | undefined;
afterEach(() => {
  opened?.unmount();
  opened = undefined;
});

describe('the status of an Event the public read does not answer', () => {
  it('is read-only when the club list says archived', async () => {
    opened = await openEventPage(<Probe />, { [EVENTS_READ]: [testEvent('archived')] });
    expect(probe()).toBe('true/true');
  });

  it('is live when the club list says running', async () => {
    opened = await openEventPage(<Probe />, { [EVENTS_READ]: [testEvent('running')] });
    expect(probe()).toBe('false/false');
  });

  it('is live for an Event the club list does not hold', async () => {
    const other = { id: 'ev2', name: 'Another day', status: 'archived' };
    opened = await openEventPage(<Probe />, { [EVENTS_READ]: [other] });
    expect(probe()).toBe('false/false');
  });

  it('draws the archived banner over the page', async () => {
    opened = await openEventPage(
      <EventLayout>
        <Probe />
      </EventLayout>,
      { [EVENTS_READ]: [testEvent('archived')], [NO_REQUEST]: null },
    );
    expect(document.body.textContent).toContain('This event is archived and read-only.');
  });

  it('draws no banner over a running Event', async () => {
    opened = await openEventPage(
      <EventLayout>
        <Probe />
      </EventLayout>,
      { [EVENTS_READ]: [testEvent('running')] },
    );
    expect(document.body.textContent).not.toContain('archived');
  });
});
