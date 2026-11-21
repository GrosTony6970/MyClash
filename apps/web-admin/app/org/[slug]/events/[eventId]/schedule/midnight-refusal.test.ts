import { describe, expect, it } from 'vitest';
import type { ApiFailure } from '@myclash/api-client';
import { createTranslator, getMessages } from '@myclash/i18n';
import { midnightRefusal } from './midnight-refusal';

const en = createTranslator(getMessages('en'));
const fr = createTranslator(getMessages('fr'));

const refused = (
  details: Record<string, unknown>,
  code = 'schedule_past_midnight',
): ApiFailure => ({
  kind: 'http',
  status: 400,
  detail: 'An English sentence.',
  code,
  details,
  validationErrors: null,
});

const MOVE_FIGHT = {
  action: { kind: 'move', bar: 'Lunch' },
  deltaMin: 90,
  crossing: { kind: 'fight', name: 'LSW-P4-M01' },
  from: '23:30',
  to: '01:00',
};

describe('the midnight refusal, in the reader’s language', () => {
  it('says a dragged bar would carry a fight past midnight', () => {
    expect(midnightRefusal(refused(MOVE_FIGHT), en)).toBe(
      'Moving "Lunch" by +90 min would carry the fight LSW-P4-M01 past midnight (23:30 becomes 01:00). Nothing was moved.',
    );
    expect(midnightRefusal(refused(MOVE_FIGHT), fr)).toBe(
      'Déplacer « Lunch » de +90 min ferait passer le combat LSW-P4-M01 après minuit (23:30 deviendrait 01:00). Rien n’a été déplacé.',
    );
  });

  it('says a day pushed back would carry a bar past midnight', () => {
    const facts = {
      action: { kind: 'delay' },
      deltaMin: 45,
      crossing: { kind: 'bar', name: 'Finals' },
      from: '23:30',
      to: '00:15',
    };
    expect(midnightRefusal(refused(facts), en)).toBe(
      'Pushing the day back by +45 min would carry the bar "Finals" past midnight (23:30 becomes 00:15). Nothing was moved.',
    );
    expect(midnightRefusal(refused(facts), fr)).toBe(
      'Décaler la journée de +45 min ferait passer la barre « Finals » après minuit (23:30 deviendrait 00:15). Rien n’a été déplacé.',
    );
  });

  it('names an unnumbered fight as a fight', () => {
    const facts = { ...MOVE_FIGHT, crossing: { kind: 'fight', name: null } };
    expect(midnightRefusal(refused(facts), en)).toContain('would carry a fight past midnight');
  });

  it('leaves every other refusal, and unreadable facts, to the API’s own words', () => {
    expect(midnightRefusal(refused(MOVE_FIGHT, 'referee_board_locked'), en)).toBeNull();
    expect(midnightRefusal(refused({ ...MOVE_FIGHT, deltaMin: '90' }), en)).toBeNull();
    expect(midnightRefusal(refused({ ...MOVE_FIGHT, crossing: { kind: 'lice' } }), en)).toBeNull();
    expect(midnightRefusal(refused({ ...MOVE_FIGHT, action: { kind: 'swap' } }), en)).toBeNull();
    expect(midnightRefusal({ kind: 'network' } as ApiFailure, en)).toBeNull();
  });
});
