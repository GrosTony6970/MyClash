import type { ApiFailure } from '@myclash/api-client';
import { createTranslator } from '@myclash/i18n/runtime';
import { messages } from '@myclash/i18n/staff';
import { describe, expect, it } from 'vitest';

import type { UndoNotice } from '../offline/db';
import { undoNoticeLines } from './refused-undo';

/**
 * What the screen of a bout says of the undos the tablet wrote down and did not carry out
 * (rulings 354, 364 to 366).
 *
 * He undid hit 5 with no connection. Before the wifi came back the Event was closed, so the
 * server refused the void. Hit 5 is on the list again, and he took it off: the screen says it
 * was refused and that it is back, then why when the pad has its own words for the server's
 * code. An undo nobody could send for a day, and one of a bout that ended meanwhile, each
 * have their sentence. Several undos are counted.
 */
const API_WORDS = 'Match is locked';
const refusal = (status: number, code: string): ApiFailure => ({
  kind: 'http',
  status,
  code,
  detail: API_WORDS,
  details: null,
  validationErrors: null,
});
let made = 0;
const notice = (why: UndoNotice['why'], refused?: ApiFailure): UndoNotice => ({
  clientUuid: `uuid-${(made += 1)}`,
  matchId: 'm1',
  why,
  refusal: refused,
  writtenAt: 0,
});
const LOCKED = refusal(400, 'match_locked');
const OVER = refusal(409, 'event_results_frozen');

describe.each([
  ['en', messages.en],
  ['fr', messages.fr],
] as const)('undoNoticeLines, %s', (_locale, tree) => {
  const t = createTranslator(tree);
  const said = t('scoring.corrections.earlierUndoRefused');

  // Whole literal keys: a key built from parts hides an orphan from the i18n sweep.
  it.each([
    'scoring.corrections.earlierUndoRefused',
    'scoring.corrections.earlierUndosRefused',
    'scoring.corrections.earlierUndoNotSent',
    'scoring.corrections.earlierUndosNotSent',
    'scoring.corrections.earlierUndoBoutEnded',
    'scoring.corrections.earlierUndosBoutEnded',
  ])('has the sentence %s in this language', (key) => {
    expect(t(key, { count: 2 })).not.toContain('scoring.corrections');
  });

  it('says nothing with nothing written down', () => {
    expect(undoNoticeLines([], t)).toEqual([]);
  });

  it('says the refusal, then the pad’s own words for a code it knows', () => {
    expect(undoNoticeLines([notice('refused', OVER)], t)).toEqual([
      `${said} ${t('scoring.corrections.eventOver')}`,
    ]);
  });

  // The commonest case: the organiser locked the bout before the wifi came back.
  it('says why for a locked bout, in the pad’s own words', () => {
    const [words] = undoNoticeLines([notice('refused', LOCKED)], t);

    expect(words).toBe(`${said} ${t('scoring.corrections.boutLocked')}`);
    expect(words).not.toContain(API_WORDS);
  });

  // A plain 400 answers `BAD_REQUEST` with an English sentence of the API.
  it('says the refusal alone for a code it does not know, never the words of the API', () => {
    const [words] = undoNoticeLines([notice('refused', refusal(400, 'BAD_REQUEST'))], t);

    expect(words).toBe(said);
  });

  // Ruling 364: one notice slot kept the last of several refusals.
  it('counts several refusals, with the reason they share', () => {
    const counted = t('scoring.corrections.earlierUndosRefused', { count: 2 });

    expect(undoNoticeLines([notice('refused', LOCKED), notice('refused', LOCKED)], t)).toEqual([
      `${counted} ${t('scoring.corrections.boutLocked')}`,
    ]);
    expect(counted).toContain('2');
  });

  it('counts several refusals with no reason when they have two', () => {
    expect(undoNoticeLines([notice('refused', LOCKED), notice('refused', OVER)], t)).toEqual([
      t('scoring.corrections.earlierUndosRefused', { count: 2 }),
    ]);
  });

  // Ruling 365.
  it('says an undo nobody could send for a day, one and several', () => {
    expect(undoNoticeLines([notice('expired')], t)).toEqual([
      t('scoring.corrections.earlierUndoNotSent'),
    ]);
    expect(undoNoticeLines([notice('expired'), notice('expired'), notice('expired')], t)).toEqual([
      t('scoring.corrections.earlierUndosNotSent', { count: 3 }),
    ]);
  });

  // Ruling 366.
  it('says an undo of a bout that ended meanwhile, one and several', () => {
    expect(undoNoticeLines([notice('ended')], t)).toEqual([
      t('scoring.corrections.earlierUndoBoutEnded'),
    ]);
    expect(undoNoticeLines([notice('ended'), notice('ended')], t)).toEqual([
      t('scoring.corrections.earlierUndosBoutEnded', { count: 2 }),
    ]);
  });

  it('says one sentence per cause, each with its own count', () => {
    const lines = undoNoticeLines(
      [notice('ended'), notice('refused', LOCKED), notice('expired'), notice('ended')],
      t,
    );

    expect(lines).toEqual([
      `${said} ${t('scoring.corrections.boutLocked')}`,
      t('scoring.corrections.earlierUndoNotSent'),
      t('scoring.corrections.earlierUndosBoutEnded', { count: 2 }),
    ]);
  });
});
