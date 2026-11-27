import { describe, expect, it } from 'vitest';
import type { ApiFailure } from '@myclash/api-client';
import { en, fr } from '@myclash/i18n';
import { messages } from '@myclash/i18n/admin';
import { createTranslator } from '@myclash/i18n/runtime';
import { swissFailureMessage, swissRefusal } from './swiss-refusal';

const t = (key: string) => key;

/** A refusal as `apiRequest` reports it. */
const refused = (
  code: string | null,
  details: Record<string, unknown> | null = null,
): ApiFailure => ({
  kind: 'http',
  status: 409,
  detail: 'An English sentence from the API.',
  code,
  details,
  validationErrors: null,
});

describe('swissRefusal', () => {
  it.each<[string, string]>([
    ['fighter_out', 'organizer.swiss.configure.fighterOut'],
    ['swiss_field_changed', 'organizer.swiss.configure.fieldChanged'],
    ['round_has_records', 'organizer.swiss.rounds.roundHasRecords'],
    ['pool_phase_missing', 'organizer.swiss.configure.poolPhaseMissing'],
    ['pool_phase_open', 'organizer.swiss.configure.poolPhaseOpen'],
    ['rating_coverage_low', 'organizer.swiss.configure.ratingCoverageLow'],
  ])('says %s in the reader’s language', (code, key) => {
    expect(swissRefusal(refused(code), t)).toBe(key);
  });

  /**
   * A French organiser seeded a Swiss phase by pool rank before the pools ended, and read
   * "by-pool-rank seeding needs the pool phase to be complete…" in English.
   */
  it('says the seeding refusals in French, with the numbers the API read', () => {
    const frT = createTranslator(messages.fr);
    expect(swissRefusal(refused('pool_phase_open'), frT)).toBe(
      'Le classement par rang de poule demande que tous les combats de poule soient terminés : certains sont encore ouverts.',
    );
    expect(
      swissRefusal(
        refused('rating_coverage_low', { rated: 1, total: 3, percent: 33, threshold: 80 }),
        frT,
      ),
    ).toBe(
      'Seuls 1 combattants sur 3 (33 %) ont un classement HEMA, sous les 80 % requis. Tirez au sort, ou baissez le seuil.',
    );
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
      'organizer.swiss.configure.poolPhaseMissing',
      'organizer.swiss.configure.poolPhaseOpen',
      'organizer.swiss.configure.ratingCoverageLow',
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
