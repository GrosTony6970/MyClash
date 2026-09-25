import { createTranslator, getMessages } from '@myclash/i18n';
import { describe, expect, it } from 'vitest';
import { GROUPS_ACTION_ERROR_KEY } from './action-error';

describe('a People hub action that fails shows its own message (ruling 118)', () => {
  const en = createTranslator(getMessages('en'));
  const fr = createTranslator(getMessages('fr'));

  it.each(Object.entries(GROUPS_ACTION_ERROR_KEY))(
    '%s has a message in English and French',
    (_kind, key) => {
      // A missing key renders as "[key]".
      expect(en(key)).not.toMatch(/^\[/);
      expect(fr(key)).not.toMatch(/^\[/);
      expect(fr(key)).not.toBe(en(key));
    },
  );

  it('says which action failed: no two failures share a message', () => {
    const keys = Object.values(GROUPS_ACTION_ERROR_KEY);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps "name already used" apart from a create or update that failed', () => {
    expect(en(GROUPS_ACTION_ERROR_KEY.nameInUse)).toBe('You already have a group with that name.');
    expect(en(GROUPS_ACTION_ERROR_KEY.follow)).toBe(
      'Could not change the follow. Please try again.',
    );
  });
});
