import { describe, expect, it } from 'vitest';
import { eventKindTone } from './event-kind-badge';

describe('eventKindTone', () => {
  it('badges a test event in the alarming tone', () => {
    // Checking twenty fighters into a rehearsal is the failure this prevents,
    // on the login screen and then on every screen for the rest of the day.
    expect(eventKindTone('test')).toEqual({
      tone: 'danger',
      labelKey: 'scoring.login.picker.badgeTest',
    });
  });

  it('badges a club event quietly', () => {
    expect(eventKindTone('club')?.tone).toBe('muted');
  });

  it('leaves a standard event unbadged', () => {
    // A badge on every event would train volunteers to read past the one that
    // matters.
    expect(eventKindTone('standard')).toBeNull();
  });

  it('leaves an unknown or absent kind unbadged rather than guessing', () => {
    expect(eventKindTone(null)).toBeNull();
    expect(eventKindTone(undefined)).toBeNull();
    expect(eventKindTone('something-new')).toBeNull();
  });
});
