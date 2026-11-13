import type { SparRefusalCode } from '@myclash/types';

/**
 * The one English sentence each word the database raises (P0001) answers as its `message`. A fixed
 * string: no name, no count, no id. The web keys on the `code` and shows its own translated
 * sentence, so these are for whoever reads the raw answer. A new word fails the typecheck here
 * until it has a sentence.
 */
export const SPAR_REFUSAL_SENTENCES: Record<SparRefusalCode, string> = {
  no_profile: 'FightBook needs a fighter profile',
  fightbook_off: 'Switch FightBook on first',
  not_on_fightbook: 'This fighter does not use FightBook',
  already_asked: 'You already asked this fighter. Wait for their answer',
  not_again: 'This fighter said "not this time". You cannot ask again for now',
  you_blocked: 'You blocked this fighter. Unblock them first',
  not_open: 'This request is no longer open',
  bad_day: 'That day cannot be chosen',
  bad_zone: 'Your time zone could not be read',
  bad_place: 'Pick a place for a free date',
  bad_weapon: 'That weapon is not on the list',
  bad_event: 'A spar can only name a public Event you are at',
  bad_answer: 'That answer is not possible',
  self: 'You cannot ask yourself',
  favourites_full: 'Your favourites list is full',
  too_many_calls: 'You have the most open calls you can have today. Close one to post another',
  bad_time: 'Choose a time later today, before the Event day ends',
  bad_code: 'This code has expired or was already used — ask them to show it again',
};
