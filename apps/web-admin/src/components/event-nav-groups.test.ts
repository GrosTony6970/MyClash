import { messages } from '@myclash/i18n';
import { describe, expect, it } from 'vitest';
import {
  EVENT_NAV_GROUPS,
  EVENT_NAV_OVERVIEW,
  isGroupOpen,
  nextGroupState,
  parseGroupState,
  serializeGroupState,
} from './event-nav-groups';

describe('group-state helpers', () => {
  it('parseGroupState returns {} for null', () => {
    expect(parseGroupState(null)).toEqual({});
  });

  it('parseGroupState returns {} for invalid JSON', () => {
    expect(parseGroupState('not json')).toEqual({});
  });

  it('parseGroupState keeps only boolean entries', () => {
    expect(parseGroupState('{"people":false,"junk":"x"}')).toEqual({ people: false });
  });

  it('round-trips through serialize/parse', () => {
    const state = { people: false, admin: true };
    expect(parseGroupState(serializeGroupState(state))).toEqual(state);
  });

  it('isGroupOpen defaults to open (true) for unknown keys', () => {
    expect(isGroupOpen({}, 'people')).toBe(true);
  });

  it('isGroupOpen returns false only when explicitly false', () => {
    expect(isGroupOpen({ people: false }, 'people')).toBe(false);
    expect(isGroupOpen({ people: true }, 'people')).toBe(true);
  });

  it('nextGroupState sets the key without mutating the input', () => {
    const input = { a: true };
    const out = nextGroupState(input, 'b', false);
    expect(out).toEqual({ a: true, b: false });
    expect(input).toEqual({ a: true });
  });
});

describe('event nav taxonomy', () => {
  const flatHrefs = [
    EVENT_NAV_OVERVIEW.href,
    ...EVENT_NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href)),
  ];

  it('covers exactly the 16 expected routes', () => {
    const expected = [
      '',
      'persons',
      'clubs',
      'referees',
      'staff',
      'tournaments',
      'pools',
      'bracket',
      'schedule',
      'leagues',
      'workshops',
      'compensation',
      'notifications',
      'theme',
      'archive',
      'ai-assistant',
    ];
    expect([...flatHrefs].sort()).toEqual([...expected].sort());
  });

  it('has no duplicate hrefs', () => {
    expect(new Set(flatHrefs).size).toBe(flatHrefs.length);
  });

  it('every group is non-empty and namespaced under organizer.shell.eventGroups', () => {
    for (const g of EVENT_NAV_GROUPS) {
      expect(g.items.length).toBeGreaterThan(0);
      expect(g.headingKey.startsWith('organizer.shell.eventGroups.')).toBe(true);
    }
  });
});

describe('event nav group headings resolve in every locale', () => {
  function resolve(tree: unknown, key: string): unknown {
    return key.split('.').reduce<unknown>((node, part) => {
      if (node && typeof node === 'object') return (node as Record<string, unknown>)[part];
      return undefined;
    }, tree);
  }

  for (const g of EVENT_NAV_GROUPS) {
    it(`${g.headingKey} resolves to a non-empty string in EN and FR`, () => {
      for (const locale of [messages.en, messages.fr]) {
        const value = resolve(locale, g.headingKey);
        expect(typeof value).toBe('string');
        expect((value as string).length).toBeGreaterThan(0);
      }
    });
  }
});
