/**
 * The notice of a new Event says its fixed words in French and in English (ruling 202). Paul
 * follows Lyon HEMA, and Lyon HEMA publishes the Open de Lyon. The title is the organisation's
 * name and the body the Event's, its date and its city: names, said once. The email subject is a
 * sentence, so it comes in both languages.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mockSupabase,
  type SupabaseRow,
  type TableSeed,
} from '../../../common/testing/supabase-chain';
import { NotificationEventsService } from './notification-events.service';

const OPEN = 'e-open';
const LYON_HEMA = 'o-lyon';

function tables(organizations: SupabaseRow[]): Record<string, TableSeed> {
  return {
    events: {
      rows: [
        {
          id: OPEN,
          name: 'Open de Lyon',
          slug: 'open-de-lyon',
          city: 'Lyon',
          start_date: '2026-10-03',
          event_kind: 'standard',
          organization_id: LYON_HEMA,
        },
      ],
    },
    organizations: { rows: organizations },
    organization_follows: {
      rows: [
        { follower_user_id: 'u-paul', followed_organization_id: LYON_HEMA, notify_new_event: true },
      ],
    },
    persons: { rows: [{ claimed_by_user_id: 'u-paul', email: 'paul@example.com' }] },
  };
}

const scheduler = { sendImmediateBulk: vi.fn() };

/** Lyon HEMA publishes the Open; the notices queued. */
async function announced(seed: Record<string, TableSeed>): Promise<unknown> {
  const db = mockSupabase(seed);
  await new NotificationEventsService(db as never, scheduler as never).organizerPublishedEvent(
    OPEN,
  );
  return scheduler.sendImmediateBulk.mock.calls[0]?.[0];
}

beforeEach(() => {
  scheduler.sendImmediateBulk.mockReset();
});

describe('the notice of a new Event', () => {
  it('names the organisation and the Event once, and says the subject twice', async () => {
    expect(await announced(tables([{ id: LYON_HEMA, name: 'Lyon HEMA' }]))).toEqual([
      {
        kind: 'organizer_published_event',
        entityId: OPEN,
        userId: 'u-paul',
        title: 'Lyon HEMA',
        body: 'Open de Lyon — 2026-10-03 · Lyon',
        url: '/e/open-de-lyon/home',
        email: 'paul@example.com',
        emailSubject: 'Lyon HEMA a publié Open de Lyon / Lyon HEMA published Open de Lyon',
        preference: 'organizer_updates',
      },
    ]);
  });

  it('calls an organisation it cannot read "an organiser", in each language', async () => {
    expect(await announced(tables([]))).toMatchObject([
      {
        title: 'Un organisateur / An organiser',
        emailSubject: 'Un organisateur a publié Open de Lyon / An organiser published Open de Lyon',
      },
    ]);
  });
});
