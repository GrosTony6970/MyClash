import { describe, expect, it } from 'vitest';
import {
  clockStatusSemantic,
  matchStatusSemantic,
  phaseVisibilitySemantic,
  rulesetSemantic,
  statusPillTone,
  tournamentStatusSemantic,
} from './status-pill';

describe('tournamentStatusSemantic', () => {
  it.each([
    ['draft', 'pending'],
    ['published', 'ready'],
    ['running', 'live'],
    ['completed', 'done'],
    ['archived', 'archived'],
  ] as const)('maps %s -> %s', (input, expected) => {
    expect(tournamentStatusSemantic(input)).toBe(expected);
  });

  it('falls back to pending for unknown status', () => {
    expect(tournamentStatusSemantic('something-new')).toBe('pending');
  });
});

describe('matchStatusSemantic', () => {
  it.each([
    ['scheduled', 'pending'],
    ['running', 'live'],
    ['paused', 'paused'],
    ['completed', 'done'],
    ['voided', 'danger'],
  ] as const)('maps %s -> %s', (input, expected) => {
    expect(matchStatusSemantic(input)).toBe(expected);
  });
});

describe('phaseVisibilitySemantic', () => {
  it('maps published -> ready', () => {
    expect(phaseVisibilitySemantic('published')).toBe('ready');
  });

  it('maps hidden -> pending', () => {
    expect(phaseVisibilitySemantic('hidden')).toBe('pending');
  });
});

describe('clockStatusSemantic', () => {
  it.each([
    ['idle', 'pending'],
    ['running', 'live'],
    ['halted', 'paused'],
    ['ended', 'done'],
  ] as const)('maps %s -> %s', (input, expected) => {
    expect(clockStatusSemantic(input)).toBe(expected);
  });
});

describe('rulesetSemantic', () => {
  it.each([
    ['draft', 'pending'],
    ['custom', 'pending'],
    ['published', 'ready'],
    ['builtin', 'ready'],
    ['default', 'ready'],
    ['pendingReview', 'paused'],
  ] as const)('maps %s -> %s', (input, expected) => {
    expect(rulesetSemantic(input)).toBe(expected);
  });
});

describe('statusPillTone', () => {
  it('emits pulse=true only for the live semantic', () => {
    expect(statusPillTone('live', 'light').pulse).toBe(true);
    expect(statusPillTone('ready', 'light').pulse).toBe(false);
    expect(statusPillTone('done', 'dark').pulse).toBe(false);
  });

  it('returns different className for light vs dark surfaces', () => {
    const light = statusPillTone('ready', 'light').className;
    const dark = statusPillTone('ready', 'dark').className;
    expect(light).not.toBe(dark);
    expect(light).toContain('blue-50');
    expect(dark).toContain('blue-900');
  });

  it('emits a non-empty className for every semantic on both surfaces', () => {
    const semantics = ['pending', 'ready', 'live', 'paused', 'done', 'archived', 'danger'] as const;
    for (const s of semantics) {
      expect(statusPillTone(s, 'light').className.length).toBeGreaterThan(0);
      expect(statusPillTone(s, 'dark').className.length).toBeGreaterThan(0);
    }
  });
});
