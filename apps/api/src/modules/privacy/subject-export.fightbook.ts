/**
 * subject-export.fightbook.ts — the FightBook rows of the subject-export census.
 *
 * Split from `subject-export.tables.ts` (the census stays there and spreads this map in place)
 * to keep that file under the 400-line cap. Every entry follows the same Art. 15(4) rule: a row
 * that names ANOTHER person's private choice is exported to the person who made it, never to the
 * person it is about.
 */
import type { SubjectTableSpec } from './subject-export.reach';

export const FIGHTBOOK_SUBJECT_TABLES: Readonly<Record<string, SubjectTableSpec>> = {
  spar_requests: {
    reaches: [
      { column: 'asker_global_person_id', reach: 'global_person' },
      { column: 'receiver_global_person_id', reach: 'global_person' },
    ],
    file: 'fightbook.csv',
    note:
      'Spar requests the subject sent or received. A comment the decliner kept private is in ' +
      'spar_private_notes, never on the row. In the hour before the expiry job a row past its ' +
      'end still reads pending.',
  },
  spar_private_notes: {
    reaches: [{ column: 'author_global_person_id', reach: 'global_person' }],
    file: 'fightbook.csv',
  },
  // Outbound only, as follows above: a block AIMED at the subject names someone else and would
  // tell the subject they were blocked (Art. 15(4)).
  fightbook_blocks: {
    reaches: [{ column: 'blocker_global_person_id', reach: 'global_person' }],
    file: 'fightbook.csv',
  },
  // Both ends: the subject reads the same stars, text and writer in the app.
  spar_thanks: {
    reaches: [
      { column: 'author_global_person_id', reach: 'global_person' },
      { column: 'subject_global_person_id', reach: 'global_person' },
    ],
    file: 'fightbook.csv',
    note: 'Thank-yous the subject wrote or received; a received one names its signed writer.',
  },
  // Writer only: a row ABOUT the subject names its writer (Art. 15(4)).
  spar_anonymous_reviews: {
    reaches: [{ column: 'author_global_person_id', reach: 'global_person' }],
    file: 'fightbook.csv',
    note: 'Only the anonymous reviews the subject wrote, never those about them.',
  },
  // Owner only, as blocks: who favourited the subject is someone else's private choice.
  fightbook_favourites: {
    reaches: [{ column: 'owner_global_person_id', reach: 'global_person' }],
    file: 'fightbook.csv',
    note: 'The fighters the subject favourited, never who favourited them.',
  },
  // Reporter only. A spar has one partner, so a flag ABOUT the subject names its writer
  // (Art. 15(4)); gear-check notes differ, their subject receives them.
  spar_flags: {
    reaches: [{ column: 'reporter_global_person_id', reach: 'global_person' }],
    file: 'fightbook.csv',
    note: 'Only the safety flags the subject wrote, never those about them.',
  },
  // Floor tools (slice 5). Each row lives an hour to a day, but the subject reads it in the app.
  fightbook_free_now: {
    reaches: [{ column: 'global_person_id', reach: 'global_person' }],
    file: 'fightbook.csv',
    note: 'The Event and time the subject marked themselves free to spar.',
  },
  // Poster only. The whole row goes: zone, day, time, weapons and the fighter the subject picked
  // (they chose that fighter and were told who it was).
  spar_open_calls: {
    reaches: [{ column: 'poster_global_person_id', reach: 'global_person' }],
    file: 'fightbook.csv',
    note: 'The open calls the subject posted. Never who answered a call that was not picked.',
  },
  // Answerer only: a poster's download never names who answered (ruling 712).
  spar_open_call_answers: {
    reaches: [{ column: 'answerer_global_person_id', reach: 'global_person' }],
    file: 'fightbook.csv',
    note: 'The calls the subject said "I am in" to, never who else answered.',
  },
};
