import { describe, expect, it } from 'vitest';
import { formatUnassignedReason } from './format-unassigned-reason';

const identity = (key: string) => key;

describe('formatUnassignedReason', () => {
  it('maps known assigner status codes to the matching i18n key', () => {
    expect(formatUnassignedReason('no_qualified_users', identity)).toBe(
      'organizer.refereesPage.unassignedReasons.no_qualified_users',
    );
    expect(
      formatUnassignedReason('all_qualified_have_time_conflict_with_other_pool', identity),
    ).toBe(
      'organizer.refereesPage.unassignedReasons.all_qualified_have_time_conflict_with_other_pool',
    );
  });

  it('falls back to the raw code when no i18n mapping exists', () => {
    expect(formatUnassignedReason('something_new_we_did_not_translate', identity)).toBe(
      'something_new_we_did_not_translate',
    );
  });
});
