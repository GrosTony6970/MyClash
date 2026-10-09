/**
 * A screen that archives an Event reads the club's list again (ruling 380).
 *
 * Every page of an Event takes its status from that list. A list read once, when
 * the shell opened, would leave the Event's pages live after it was archived.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import {
  API,
  EVENTS_READ,
  EVENT_ID,
  openEventPage,
  type OpenedPage,
} from '../[eventId]/archived-page.fixtures';
import { RequestDeletionModal } from './RequestDeletionModal';

vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

const ARCHIVE = `PATCH /api/v1/events/${EVENT_ID}`;
const REQUEST = 'POST /api/v1/deletion-requests';
const RUNNING = [{ id: EVENT_ID, name: 'Open 2025', status: 'running' }];

const listReads = () =>
  vi.mocked(fetch).mock.calls.filter(([url]) => String(url) === `${API}${EVENTS_READ}`).length;

function modal(archiveFirst: boolean) {
  return (
    <RequestDeletionModal
      targetType="event"
      targetId={EVENT_ID}
      targetLabel="Open 2025"
      archiveFirst={archiveFirst}
      onSuccess={() => undefined}
      onClose={() => undefined}
    />
  );
}

let opened: OpenedPage | undefined;
afterEach(() => {
  opened?.unmount();
  opened = undefined;
});

/** Opens the dialog over a running Event and presses its submit button, once. */
async function submit(archiveFirst: boolean, taken: Record<string, unknown>): Promise<OpenedPage> {
  opened = await openEventPage(modal(archiveFirst), { [EVENTS_READ]: RUNNING }, taken);
  expect(listReads()).toBe(1);
  const button = [...document.querySelectorAll('button')].find(
    (b) => b.textContent === 'Submit request',
  );
  await act(async () => button?.click());
  await opened.settle();
  return opened;
}

describe('the deletion dialog and the club list', () => {
  it('reads the list again once it archived the Event', async () => {
    const page = await submit(true, { [ARCHIVE]: {}, [REQUEST]: {} });
    expect(page.writes()).toEqual([ARCHIVE, REQUEST]);
    expect(listReads()).toBe(2);
  });

  it('reads it again when the request after the archive is refused', async () => {
    const page = await submit(true, { [ARCHIVE]: {} });
    expect(page.writes()).toEqual([ARCHIVE, REQUEST]);
    expect(listReads()).toBe(2);
  });

  it('reads nothing again when the archive is refused', async () => {
    const page = await submit(true, {});
    expect(page.writes()).toEqual([ARCHIVE]);
    expect(listReads()).toBe(1);
  });

  it('reads nothing again for an Event that was archived already', async () => {
    const page = await submit(false, { [REQUEST]: {} });
    expect(page.writes()).toEqual([REQUEST]);
    expect(listReads()).toBe(1);
  });
});

describe('the Events list page', () => {
  it('reads the list again after its edit form saved, which sends the status', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const page = readFileSync(join(here, '..', 'page.tsx'), 'utf8');
    const save = page.slice(page.indexOf('status: form.status,'), page.indexOf('closeEdit();'));
    expect(save).toContain("method: 'PATCH'");
    expect(save).toMatch(/if \(!r\.ok\) \{[^}]*return;\s*\}[^}]*void refetchEvents\(\);/);
  });
});
