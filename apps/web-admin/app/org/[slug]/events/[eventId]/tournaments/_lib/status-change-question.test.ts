import { describe, expect, it } from 'vitest';
import type { Translator } from '@myclash/next-i18n/client';
import { statusChangeQuestion } from './status-change-question';

const t: Translator = (key, values) => (values ? `${key} ${JSON.stringify(values)}` : key);

describe('the question asked before a Tournament takes a status', () => {
  it.each(['draft', 'published', 'running'])('asks nothing before "%s"', (status) => {
    expect(statusChangeQuestion(status, 'Longsword', t)).toBeNull();
  });

  it('names the Tournament and the notice before "completed"', () => {
    expect(statusChangeQuestion('completed', 'Longsword', t)).toEqual({
      title: 'organizer.tournaments.statusConfirm.completedTitle {"name":"Longsword"}',
      description: 'organizer.tournaments.statusConfirm.completedBody',
      confirmLabel: 'organizer.tournaments.statusConfirm.completedYes',
      cancelLabel: 'common.cancel',
      danger: true,
    });
  });

  it('names the Tournament and what the public loses before "archived"', () => {
    expect(statusChangeQuestion('archived', 'Longsword', t)).toEqual({
      title: 'organizer.tournaments.statusConfirm.archivedTitle {"name":"Longsword"}',
      description: 'organizer.tournaments.statusConfirm.archivedBody',
      confirmLabel: 'organizer.tournaments.statusConfirm.archivedYes',
      cancelLabel: 'common.cancel',
      danger: true,
    });
  });
});
