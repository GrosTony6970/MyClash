import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { NotificationSchedulerWorker } from './notification-scheduler.worker';

// Whether an alert is still WANTED is held in alert-still-wanted.test.ts: here every alert is.
vi.mock('./alert-still-wanted', () => ({ isStillWanted: async () => true }));

/** A reader with no phone set up and every switch on: the notice goes by email. */
function noPhoneDatabase() {
  const rows: Record<string, unknown> = {
    push_subscriptions: { data: [], error: null },
    notification_preferences: { data: { user_id: 'user-1', enabled: true }, error: null },
  };
  return vi.fn((table: string) => {
    const result = rows[table] ?? { data: null, error: null };
    const chain = Object.assign(Promise.resolve(result), {
      select: vi.fn(),
      eq: vi.fn(),
      in: vi.fn(),
      update: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue(result),
    });
    chain.select.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    chain.in.mockReturnValue(chain);
    chain.update.mockReturnValue(chain);
    return chain;
  });
}

async function mailedLink(kind: string, url: string): Promise<unknown> {
  const mail = {
    sendNotification: vi.fn().mockResolvedValue(undefined),
    sendBroadcastNotification: vi.fn().mockResolvedValue(undefined),
  };
  const worker = new NotificationSchedulerWorker(
    { service: { from: noPhoneDatabase() } } as never,
    new ConfigService({ DOMAIN: 'example.test' }) as never,
    { send: vi.fn() } as never,
    mail as never,
  );
  await worker.process({
    id: 'job-1',
    data: {
      kind,
      entityId: 'entity-1',
      userId: 'user-1',
      title: 'A title',
      body: 'A body.',
      url,
      email: 'reader@example.test',
    },
  } as never);
  const sent = [...mail.sendNotification.mock.calls, ...mail.sendBroadcastNotification.mock.calls];
  expect(sent).toHaveLength(1);
  return (sent[0]?.[0] as { actionUrl?: string }).actionUrl;
}

/**
 * A notice carries a path on the public app: the phone's service worker opens it on its own
 * site. An email has no site, so its button must carry the whole address, or it goes nowhere.
 */
describe('the email fallback links to the public app', () => {
  it('turns a notice path into a full public-app address', async () => {
    await expect(mailedLink('spar_agreed', '/me/fightbook?tab=spars')).resolves.toBe(
      'https://app.example.test/me/fightbook?tab=spars',
    );
  });

  it('does the same for an organiser broadcast', async () => {
    await expect(mailedLink('organizer_broadcast', '/notifications')).resolves.toBe(
      'https://app.example.test/notifications',
    );
  });

  it('keeps an address that is already whole', async () => {
    await expect(
      mailedLink('spar_agreed', 'https://admin.example.test/admin/fightbook-flags'),
    ).resolves.toBe('https://admin.example.test/admin/fightbook-flags');
  });
});
