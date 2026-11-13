import type { KnownTranslationKey } from '@myclash/i18n';
import type { SparRefusalCode } from '@myclash/types';

/** Whole keys, one per code, so the i18n sweep sees each one used. */
const KEYS: Record<SparRefusalCode, KnownTranslationKey> = {
  no_profile: 'publicApp.fightBook.refusal.no_profile',
  fightbook_off: 'publicApp.fightBook.refusal.fightbook_off',
  not_on_fightbook: 'publicApp.fightBook.refusal.not_on_fightbook',
  already_asked: 'publicApp.fightBook.refusal.already_asked',
  not_again: 'publicApp.fightBook.refusal.not_again',
  you_blocked: 'publicApp.fightBook.refusal.you_blocked',
  not_open: 'publicApp.fightBook.refusal.not_open',
  bad_day: 'publicApp.fightBook.refusal.bad_day',
  bad_zone: 'publicApp.fightBook.refusal.bad_zone',
  bad_place: 'publicApp.fightBook.refusal.bad_place',
  bad_weapon: 'publicApp.fightBook.refusal.bad_weapon',
  bad_event: 'publicApp.fightBook.refusal.bad_event',
  bad_answer: 'publicApp.fightBook.refusal.bad_answer',
  self: 'publicApp.fightBook.refusal.self',
  favourites_full: 'publicApp.fightBook.refusal.favourites_full',
  too_many_calls: 'publicApp.fightBook.refusal.too_many_calls',
  bad_time: 'publicApp.fightBook.refusal.bad_time',
  bad_code: 'publicApp.fightBook.refusal.bad_code',
};

/** The sentence for a FightBook refusal `code`; anything else, the general one. */
export function sparRefusalKey(code: string | null): KnownTranslationKey {
  return (code && KEYS[code as SparRefusalCode]) || 'publicApp.fightBook.refusal.unknown';
}
