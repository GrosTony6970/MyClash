/**
 * What the round-break screen says after an undo that left its round closed
 * (operator, 2026-10-11).
 *
 * Best-of-3, round 1 ended on "End round" at red 2 - 1. "Undo last entry"
 * cancelled blue's hit: the screen read 2 - 0 and stayed up with no word. It
 * now names the entry, as the bout's list writes it, and says the round stays
 * closed.
 */
import { createTranslator } from '@myclash/i18n/runtime';
import { messages } from '@myclash/i18n/staff';
import { DEFAULT_SCORING_CONFIG } from '@myclash/types';
import type { ExchangeRow, MatchProtest, Penalty } from '@myclash/ui';
import { describe, expect, it } from 'vitest';
import { entryLine, roundStaysClosed } from './undone-line';

const en = createTranslator(messages.en);
const fr = createTranslator(messages.fr);

const hit = (id: string, minute: number, side: 'red' | 'blue', points: number): ExchangeRow => ({
  id,
  client_uuid: `uuid-${id}`,
  sequence: minute,
  type: 'clean',
  voided: false,
  occurredAt: `2026-10-11T10:0${minute}:00.000Z`,
  clockTimeMs: minute * 1000,
  scoringSide: side,
  scoreDelta: points,
});

const card = {
  id: 'card-1',
  client_uuid: 'uuid-card-1',
  sequence: 9,
  registration_id: 'reg-blue',
  team_id: null,
  card: 'yellow',
  source: 'ruleset',
  short_name: 'Late start',
  score_delta: -1,
  causes_match_forfeit: false,
  voided: false,
  occurred_at: '2026-10-11T10:09:00.000Z',
  clock_time_ms: 9000,
} as Penalty;

/** The bout as its screen holds it: two hits on the server, one that waits, one card. */
const screen = {
  scoring: {
    activeExchanges: [hit('ex-1', 1, 'red', 2), hit('ex-2', 2, 'blue', 1)],
    pendingExchanges: [{ ...hit('uuid-3', 3, 'red', 1), client_uuid: 'uuid-3', pending: true }],
    activePenalties: [card],
    pendingPenalties: [],
    activeProtests: [] as MatchProtest[],
    pendingProtests: [] as MatchProtest[],
  },
  match: {
    redRegistrationId: 'reg-red',
    blueRegistrationId: 'reg-blue',
    redFighterName: 'Ana Red',
    blueFighterName: 'Bo Blue',
  },
  config: DEFAULT_SCORING_CONFIG,
  t: en,
};

describe('entryLine', () => {
  it('words a hit the server holds as the bout’s list does, with its number', () => {
    expect(entryLine({ id: 'ex-2', clientUuid: 'uuid-ex-2' }, screen)).toBe(
      '#2 · 00:02 · Bo Blue · Clean hit +1',
    );
  });

  it('finds a hit that waited on the tablet by the tablet’s id', () => {
    expect(entryLine({ clientUuid: 'uuid-3' }, screen)).toBe('#3 · 00:03 · Ana Red · Clean hit +1');
  });

  it('words a card with its name and its fighter', () => {
    expect(entryLine({ id: 'card-1', clientUuid: 'uuid-card-1' }, screen)).toBe(
      '#4 · 00:09 · Bo Blue · Late start -1',
    );
  });

  it('a side with no name reads as the pad’s word for that side', () => {
    const match = { redRegistrationId: 'reg-red', blueRegistrationId: 'reg-blue' };
    const unnamed = { ...screen, match };
    expect(entryLine({ id: 'ex-2', clientUuid: 'uuid-ex-2' }, unnamed)).toContain(
      en('scoring.lice.blue'),
    );
    expect(entryLine({ id: 'ex-1', clientUuid: 'uuid-ex-1' }, unnamed)).toContain(
      en('scoring.lice.red'),
    );
  });

  // The number is the list's own: a card that waits on the tablet counts in it.
  it('numbers the entry as the list does, the cards that wait on the tablet included', () => {
    const waits = { ...card, id: 'uuid-card-0', occurred_at: '2026-10-11T10:00:30.000Z' };
    const scoring = { ...screen.scoring, pendingPenalties: [{ ...waits, pending: true }] };
    expect(entryLine({ id: 'ex-2', clientUuid: 'uuid-ex-2' }, { ...screen, scoring })).toBe(
      '#3 · 00:02 · Bo Blue · Clean hit +1',
    );
  });

  // A protest has no number in the bout's list, so its line is a sentence of its own.
  it('names a protest by its fighter, with no number, and the hits keep theirs', () => {
    const protest: MatchProtest = {
      id: 'protest-1',
      client_uuid: 'uuid-protest-1',
      match_id: 'bout-1',
      registration_id: 'reg-blue',
      team_id: null,
      sequence: 1,
      round_number: 1,
      clock_time_ms: 1500,
      occurred_at: '2026-10-11T10:01:30.000Z',
      voided: false,
    };
    const scoring = { ...screen.scoring, activeProtests: [protest] };
    const taken = { id: 'protest-1', clientUuid: 'uuid-protest-1' };

    expect(entryLine(taken, { ...screen, scoring })).toBe('Protest by Bo Blue');
    expect(entryLine(taken, { ...screen, scoring, t: fr })).toBe('Réclamation de Bo Blue');
    expect(entryLine({ id: 'ex-2', clientUuid: 'uuid-ex-2' }, { ...screen, scoring })).toBe(
      '#2 · 00:02 · Bo Blue · Clean hit +1',
    );
  });

  it('names a protest that waits on the tablet by the tablet’s id', () => {
    const waits: MatchProtest = {
      id: 'uuid-protest-2',
      client_uuid: 'uuid-protest-2',
      match_id: 'bout-1',
      registration_id: 'reg-red',
      team_id: null,
      sequence: 5,
      round_number: 1,
      clock_time_ms: 9500,
      occurred_at: '2026-10-11T10:09:30.000Z',
      voided: false,
      pending: true,
    };
    const scoring = { ...screen.scoring, pendingProtests: [waits] };

    expect(entryLine({ clientUuid: 'uuid-protest-2' }, { ...screen, scoring })).toBe(
      'Protest by Ana Red',
    );
  });

  // Another tablet scored it a moment ago: this screen's list does not hold it yet.
  it('gives nothing for an entry the screen’s list does not hold', () => {
    expect(entryLine({ id: 'ex-9', clientUuid: 'uuid-ex-9' }, screen)).toBeNull();
  });
});

describe('roundStaysClosed', () => {
  it('names the entry and the round', () => {
    expect(roundStaysClosed('#2 · 0:02 · Bo Blue · Clean +1', 1, en)).toBe(
      'Cancelled: #2 · 0:02 · Bo Blue · Clean +1. Round 1 stays closed.',
    );
    expect(roundStaysClosed('#2 · 0:02 · Bo Blue · Net +1', 2, fr)).toBe(
      'Annulé : #2 · 0:02 · Bo Blue · Net +1. La manche 2 reste terminée.',
    );
  });

  it('says so with no name when the entry is not on the screen’s list', () => {
    expect(roundStaysClosed(null, 1, en)).toBe(
      'The last entry was cancelled. Round 1 stays closed.',
    );
    expect(roundStaysClosed(null, 3, fr)).toBe(
      'La dernière saisie est annulée. La manche 3 reste terminée.',
    );
  });
});
