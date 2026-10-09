import { describe, expect, it } from 'vitest';
import type { Translator } from '@myclash/next-i18n/client';
import { sessionDeleteQuestion } from './session-delete-question';

const t: Translator = (key, values) => (values ? `${key} ${JSON.stringify(values)}` : key);

describe('the question asked before a Workshop session is deleted', () => {
  it('asks nothing while nobody is booked: the Workshop goes back to the drawer', () => {
    expect(sessionDeleteQuestion('Saturday longsword', 0, t)).toBeNull();
  });

  it('names the Workshop and counts the bookings that go with the session', () => {
    expect(sessionDeleteQuestion('Saturday longsword', 12, t)).toEqual({
      title: 'organizer.workshopsPage.sessionDelete.title {"title":"Saturday longsword"}',
      description: 'organizer.workshopsPage.sessionDelete.body {"count":12}',
      confirmLabel: 'organizer.workshopsPage.sessionDelete.yes',
      cancelLabel: 'common.cancel',
      danger: true,
    });
  });

  it('asks for one booking', () => {
    expect(sessionDeleteQuestion('Saturday longsword', 1, t)).not.toBeNull();
  });

  it('asks without a count when the roster could not be read', () => {
    expect(sessionDeleteQuestion('Saturday longsword', null, t)?.description).toBe(
      'organizer.workshopsPage.sessionDelete.bodyUncounted',
    );
  });
});
