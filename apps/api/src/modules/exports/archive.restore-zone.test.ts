import { describe, expect, it } from 'vitest';
import { makeService } from './archive.fixtures';

/**
 * An archive carries its Event's zone as text, and a hand-edited one can say anything. A restore
 * stores only an IANA name: a zone that is not one becomes Europe/Paris, and the result says so,
 * as it says which ruleset pins and compensation plans it dropped (ruling 415).
 */
describe('ArchiveService — the restored Event zone', () => {
  async function restoreWith(event: Record<string, unknown>) {
    const { service, inserted } = makeService({
      events: [
        { id: 'existing', organization_id: 'org-1', slug: 'target', name: 'T', status: 'draft' },
      ],
    });
    const archive = {
      manifest: 'myclash.archive.v1',
      version: 1,
      generatedAt: new Date().toISOString(),
      scope: 'event',
      include: 'structure',
      source: { eventId: 'event-1', eventSlug: 'fal', eventName: 'FAL', eventStatus: 'completed' },
      data: {
        events: [
          {
            id: 'event-1',
            organization_id: 'org-1',
            slug: 'fal',
            name: 'FAL',
            status: 'completed',
            ...event,
          },
        ],
      },
      reports: { tournaments: [] },
    };
    const result = await service.restoreArchiveCopy(
      Buffer.from(JSON.stringify(archive)),
      'user-1',
      {
        targetOrganizationId: 'org-1',
        confirmation: 'RESTORE MYCLASH ARCHIVE',
      },
    );
    return { stored: inserted.events?.[0]?.['timezone'], reset: result.timezoneReset };
  }

  it('keeps an IANA zone', async () => {
    expect(await restoreWith({ timezone: 'Asia/Tokyo' })).toEqual({
      stored: 'Asia/Tokyo',
      reset: false,
    });
  });

  it('keeps an IANA zone in its one spelling, without calling it a reset', async () => {
    expect(await restoreWith({ timezone: 'us/eastern' })).toEqual({
      stored: 'America/New_York',
      reset: false,
    });
  });

  it.each([['Paris time'], ['local'], ['+03:00'], [42]])(
    'stores Europe/Paris for %j, and says so',
    async (timezone) => {
      expect(await restoreWith({ timezone })).toEqual({ stored: 'Europe/Paris', reset: true });
    },
  );

  it('stores Europe/Paris for an archive that names no zone, and says so', async () => {
    expect(await restoreWith({})).toEqual({ stored: 'Europe/Paris', reset: true });
  });
});
