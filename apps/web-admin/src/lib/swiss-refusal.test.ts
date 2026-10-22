import { describe, expect, it } from 'vitest';
import type { ApiFailure } from '@myclash/api-client';
import { en, fr } from '@myclash/i18n';
import { swissFailureMessage, swissRefusal } from './swiss-refusal';

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

describe('swissRefusal', () => {
  it.each<[string, string]>([
    ['fighter_out', 'organizer.swiss.configure.fighterOut'],
    ['swiss_field_changed', 'organizer.swiss.configure.fieldChanged'],
    ['round_has_records', 'organizer.swiss.rounds.roundHasRecords'],
  ])('says %s in the reader’s language', (code, key) => {
    expect(swissRefusal(refused(code), t)).toBe(key);
  });

  it('has each sentence in English and in French', () => {
    const at = (messages: unknown, key: string) =>
      key
        .split('.')
        .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], messages);
    for (const key of [
      'organizer.swiss.configure.fighterOut',
      'organizer.swiss.configure.fieldChanged',
      'organizer.swiss.rounds.roundHasRecords',
    ]) {
      expect(typeof at(en, key), `en ${key}`).toBe('string');
      expect(typeof at(fr, key), `fr ${key}`).toBe('string');
      expect(at(fr, key), `fr ${key}`).not.toBe(at(en, key));
    }
  });

  it('leaves every other refusal to the caller', () => {
    expect(swissRefusal(refused('CONFLICT'), t)).toBeNull();
    expect(swissRefusal(refused(null), t)).toBeNull();
    expect(swissRefusal({ kind: 'aborted' }, t)).toBeNull();
  });

  it('a tab shows the refusal, and the API’s own sentence for anything else', () => {
    expect(swissFailureMessage(refused('fighter_out'), t, 'fallback')).toBe(
      'organizer.swiss.configure.fighterOut',
    );
    expect(swissFailureMessage(refused('CONFLICT'), t, 'fallback')).toBe(
      'An English sentence from the API.',
    );
  });
});
