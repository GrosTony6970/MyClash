import { describe, expect, it } from 'vitest';
import { participantName } from './participant-name';

const t = (key: string) => key;
const tournament = {
  id: 't1',
  slug: 'longsword',
  name: 'Longsword',
  color: null,
  registrationState: 'active' as const,
};

describe('participantName', () => {
  it('keeps a name the server sent', () => {
    expect(
      participantName({ displayName: 'Léa Martin', isReferee: false, tournaments: [] }, t),
    ).toBe('Léa Martin');
  });

  it('words a blank name by what the person does at the Event, never an id', () => {
    expect(
      participantName({ displayName: '', isReferee: true, tournaments: [tournament] }, t),
    ).toBe('common.unknownName.fighter');
    expect(participantName({ displayName: ' ', isReferee: true, tournaments: [] }, t)).toBe(
      'common.unknownName.referee',
    );
    expect(participantName({ displayName: '', isReferee: false, tournaments: [] }, t)).toBe(
      'common.unknownName.person',
    );
  });
});
