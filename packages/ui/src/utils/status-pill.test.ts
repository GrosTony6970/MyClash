import { describe, expect, it } from 'vitest';
import {
  clockStatusSemantic,
  matchStatusSemantic,
  phaseVisibilitySemantic,
  rulesetSemantic,
  statusPillClass,
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

describe('statusPillClass', () => {
  it('carries the palette through, so geometry and colour cannot drift apart', () => {
    const tone = statusPillTone('danger', 'light');
    expect(statusPillClass('danger', 'light')).toContain(tone.className);
  });

  it('defaults to the md pill — what StatusBadge always rendered', () => {
    const cls = statusPillClass('ready', 'light');
    expect(cls).toContain('rounded-full');
    expect(cls).toContain('px-2.5 py-0.5');
    expect(cls).toContain('leading-5');
  });

  it.each([
    ['sm', 'px-2 py-0.5'],
    ['md', 'px-2.5 py-0.5'],
    ['lg', 'px-3 py-1'],
  ] as const)('gives %s its own footprint', (size, padding) => {
    expect(statusPillClass('ready', 'light', { size })).toContain(padding);
  });

  it('makes lg the uppercase letter-spaced header treatment', () => {
    const cls = statusPillClass('ready', 'light', { size: 'lg' });
    expect(cls).toContain('uppercase');
    expect(cls).toContain('tracking-[0.14em]');
  });

  it('squares off the flag shape but keeps the pill rounded', () => {
    const flag = statusPillClass('paused', 'light', { shape: 'flag' });
    expect(flag).toContain('rounded ');
    expect(flag).not.toContain('rounded-full');
    expect(statusPillClass('paused', 'light')).toContain('rounded-full');
  });

  it('pulses only for live, matching statusPillTone', () => {
    expect(statusPillClass('live', 'light')).toContain('animate-pulse');
    expect(statusPillClass('ready', 'light')).not.toContain('animate-pulse');
  });

  it('honours the surface', () => {
    expect(statusPillClass('ready', 'dark')).toContain('blue-900');
    expect(statusPillClass('ready', 'light')).toContain('blue-50');
  });

  it('sets no display class — a <select> must own its own display', () => {
    const cls = statusPillClass('ready', 'light');
    expect(cls).not.toContain('inline-flex');
    expect(cls).not.toContain('inline-block');
  });

  it('emits a usable class string for every semantic, size and shape', () => {
    const semantics = ['pending', 'ready', 'live', 'paused', 'done', 'archived', 'danger'] as const;
    for (const semantic of semantics) {
      for (const size of ['sm', 'md', 'lg'] as const) {
        for (const shape of ['pill', 'flag'] as const) {
          const cls = statusPillClass(semantic, 'light', { size, shape });
          expect(cls).toContain('border');
          expect(cls.trim()).toBe(cls);
        }
      }
    }
  });
});
