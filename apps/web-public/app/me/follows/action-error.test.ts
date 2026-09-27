import { createTranslator, getMessages } from '@myclash/i18n';
import { describe, expect, it } from 'vitest';
import {
  caughtFailure,
  failureOf,
  followFailureOf,
  GROUPS_ACTION_ERROR_KEY,
  refusalKey,
} from './action-error';

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

describe('a signed-out People hub action says so (ruling 123)', () => {
  it('a 401 is "signed out", whatever the action', () => {
    for (const action of ['create', 'update', 'follow', 'nameInUse'] as const) {
      expect(failureOf(401, action)).toBe('signedOut');
    }
  });

  it.each([400, 403, 404, 409, 500, 503])('a %i keeps the action’s own failure', (status) => {
    expect(failureOf(status, 'update')).toBe('update');
  });

  it('the catch reads the kind the action threw', () => {
    expect(caughtFailure(new Error('signedOut'), 'create')).toBe('signedOut');
    expect(caughtFailure(new Error('nameInUse'), 'create')).toBe('nameInUse');
  });

  it('a dropped request, or anything else, is the action’s own failure', () => {
    expect(caughtFailure(new TypeError('Failed to fetch'), 'follow')).toBe('follow');
    expect(caughtFailure(new Error('constructor'), 'follow')).toBe('follow');
    expect(caughtFailure('boom', 'update')).toBe('update');
  });
});

describe('the Following and Organizers tabs’ messages (ruling 123)', () => {
  it('a 401 is the session message; anything else the action’s own', () => {
    expect(refusalKey(401, 'publicApp.me.follows.updateFailed')).toBe(
      'publicApp.me.people.sessionEnded',
    );
    expect(refusalKey(500, 'publicApp.me.follows.updateFailed')).toBe(
      'publicApp.me.follows.updateFailed',
    );
    expect(refusalKey(null, 'publicApp.me.follows.unfollowFailed')).toBe(
      'publicApp.me.follows.unfollowFailed',
    );
  });
});

describe('a hub follow of someone who prefers not to be followed says so (ruling 158)', () => {
  it('the refusal with its own code is told apart, in English and French', () => {
    expect(followFailureOf(403, 'prefers_not_followed')).toBe('prefersNotFollowed');
    expect(caughtFailure(new Error('prefersNotFollowed'), 'follow')).toBe('prefersNotFollowed');
    const en = createTranslator(getMessages('en'));
    expect(en(GROUPS_ACTION_ERROR_KEY.prefersNotFollowed)).toBe(
      'This person prefers not to be followed',
    );
  });

  it('any other refusal keeps the follow failure, and a 401 the session one', () => {
    // An archived Event refuses every follow write with a 403 too: it must not blame the person.
    expect(followFailureOf(403, 'archived')).toBe('follow');
    expect(followFailureOf(403, undefined)).toBe('follow');
    expect(followFailureOf(500, 'prefers_not_followed')).toBe('follow');
    expect(followFailureOf(401, undefined)).toBe('signedOut');
  });
});
