import { describe, expect, it } from 'vitest';
import { createTranslator, en, fr } from '@myclash/i18n';
import { dataTooLargeMessage, restorePath } from './use-archive-restore';

/** An archive whose data is over its limit, as the API refuses it (ruling 409). */
const tooLarge = (code: string, details: Record<string, unknown> | null) => ({
  kind: 'http' as const,
  status: 413,
  detail: "This archive's data is over the 25 MB limit.",
  code,
  details,
  validationErrors: null,
});

describe('dataTooLargeMessage', () => {
  it('words the refusal with its limit, in both languages', () => {
    const failure = tooLarge('archive_data_too_large', { maxBytes: 25 * 1024 * 1024 });
    expect(dataTooLargeMessage(failure, createTranslator(en))).toBe(
      "This archive's data is larger than the 25 MB limit. It cannot be restored.",
    );
    expect(dataTooLargeMessage(failure, createTranslator(fr))).toBe(
      'Les données de cette archive dépassent la limite de 25 Mo. Elle ne peut pas être restaurée.',
    );
  });

  it('leaves every other refusal to failureMessage', () => {
    const t = createTranslator(en);
    expect(dataTooLargeMessage(tooLarge('file_too_large', { maxBytes: 1 }), t)).toBeNull();
    expect(dataTooLargeMessage(tooLarge('archive_data_too_large', null), t)).toBeNull();
    expect(dataTooLargeMessage({ kind: 'aborted' }, t)).toBeNull();
  });
});

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
