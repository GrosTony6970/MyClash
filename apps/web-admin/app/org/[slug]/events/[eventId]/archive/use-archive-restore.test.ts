import { describe, expect, it } from 'vitest';
import { restorePath } from './use-archive-restore';

/** Where a restore goes, by the scope the server's preview read in the file. */
describe('restorePath', () => {
  it('sends a whole Event to the club, never into this Event', () => {
    expect(restorePath('event', 'ev1', 'org-1')).toBe(
      '/api/v1/archive/restore?confirmation=RESTORE+MYCLASH+ARCHIVE&targetOrganizationId=org-1',
    );
  });

  it('sends one Tournament into this Event, never to the club', () => {
    expect(restorePath('tournament', 'ev1', 'org-1')).toBe(
      '/api/v1/archive/restore?confirmation=RESTORE+MYCLASH+ARCHIVE&targetEventId=ev1',
    );
  });

  it('names no target before the club is known', () => {
    expect(restorePath('event', 'ev1', undefined)).toBe(
      '/api/v1/archive/restore?confirmation=RESTORE+MYCLASH+ARCHIVE',
    );
  });
});
