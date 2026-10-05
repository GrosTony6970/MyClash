import { describe, expect, it } from 'vitest';
import type { ApiFailure } from '@myclash/api-client';
import { correctionFailureMessage, correctionRefusal } from './correction-refusal';

const t = (key: string) => key;

/** A refusal as `apiRequest` reports it. */
const refused = (code: string | null): ApiFailure => ({
  kind: 'http',
  status: 409,
  detail: 'An English sentence from the API.',
  code,
  details: null,
  validationErrors: null,
});

describe('correctionRefusal', () => {
  it.each<[string, string]>([
    ['correction_later_bout_fought', 'admin.common.correctionLaterBoutFought'],
    ['correction_leaves_bout_level', 'admin.common.correctionLeavesBoutLevel'],
    ['correction_changes_closed_round', 'admin.common.correctionChangesClosedRound'],
    ['event_results_frozen', 'admin.common.eventResultsFrozen'],
    ['exchange_from_before_reset', 'admin.common.exchangeFromBeforeReset'],
  ])('says %s in the reader’s language', (code, key) => {
    expect(correctionRefusal(refused(code), t)).toBe(key);
  });

  it('leaves every other refusal to the caller', () => {
    expect(correctionRefusal(refused('CONFLICT'), t)).toBeNull();
    expect(correctionRefusal(refused(null), t)).toBeNull();
    expect(correctionRefusal({ kind: 'aborted' }, t)).toBeNull();
  });

  it('a screen shows the refusal, and the API’s own sentence for anything else', () => {
    const refusedWhole = refused('correction_later_bout_fought');
    expect(correctionFailureMessage(refusedWhole, t, 'fallback')).toBe(
      'admin.common.correctionLaterBoutFought',
    );
    expect(correctionFailureMessage(refused('CONFLICT'), t, 'fallback')).toBe(
      'An English sentence from the API.',
    );
  });
});
