import { describe, expect, it } from 'vitest';
import type { Translator } from '@myclash/next-i18n/client';
import { broadcastQuestion, narrowedToTournament } from './broadcast-question';

const t: Translator = (key, values) => (values ? `${key} ${JSON.stringify(values)}` : key);

const MESSAGE = {
  title: 'Lunch',
  audience: 'Referees only',
  severity: 'Alert',
  selectedCount: null,
  oneTournament: false,
};

describe('the question asked before a broadcast leaves', () => {
  it('names the message, the audience and the type', () => {
    expect(broadcastQuestion(MESSAGE, t)).toEqual({
      title: 'organizer.broadcast.confirmTitle {"title":"Lunch"}',
      description:
        'organizer.broadcast.confirmBody {"audience":"Referees only","severity":"Alert"}',
      confirmLabel: 'organizer.broadcast.send',
      cancelLabel: 'common.cancel',
    });
  });

  it('says so when the audience is kept to one Tournament', () => {
    expect(broadcastQuestion({ ...MESSAGE, oneTournament: true }, t).description).toBe(
      'organizer.broadcast.confirmBodyOneTournament {"audience":"Referees only","severity":"Alert"}',
    );
  });

  it('counts the people picked by hand instead of naming their button', () => {
    const question = broadcastQuestion({ ...MESSAGE, selectedCount: 3 }, t);
    expect(question.description).toBe(
      'organizer.broadcast.confirmBody {"audience":"organizer.broadcast.confirmSelected {\\"count\\":3}","severity":"Alert"}',
    );
  });

  it('counts them when nobody is picked yet', () => {
    const question = broadcastQuestion({ ...MESSAGE, selectedCount: 0 }, t);
    expect(question.description).toContain('{\\"count\\":0}');
  });
});

describe('the audiences the server keeps to the Tournament in the address', () => {
  it.each(['fighters', 'referees', 'fighters_and_referees'])('narrows "%s"', (targetType) => {
    expect(narrowedToTournament(targetType, 't-1')).toBe(true);
    expect(narrowedToTournament(targetType, null)).toBe(false);
  });

  it.each(['all', 'specific_persons'])('does not narrow "%s"', (targetType) => {
    expect(narrowedToTournament(targetType, 't-1')).toBe(false);
  });
});
