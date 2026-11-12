import { messages } from '@myclash/i18n';
import { NAV_ICON_NAMES } from '@myclash/ui';
import { describe, expect, it } from 'vitest';
import {
  applyMenuProfile,
  EVENT_NAV_GROUPS,
  EVENT_NAV_OVERVIEW,
  shownIn,
  WORKSHOPS_MOVES,
  isGroupOpen,
  nextGroupState,
  parseGroupState,
  serializeGroupState,
} from './event-nav-groups';
import { ORG_NAV_ITEMS } from './org-nav-items';

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

  it('covers exactly the 26 expected routes', () => {
    const expected = [
      '',
      'persons',
      'clubs',
      'referees',
      'staff',
      'day',
      'live',
      'tournaments',
      'pools',
      'swiss',
      'bracket',
      'finalranking',
      'hema-ratings',
      'schedule',
      'statistics',
      'clock',
      'debrief',
      'workshops',
      'penalties',
      'compensation',
      'notifications',
      'photos',
      'theme',
      'archive',
      'ai-assistant',
      'chat',
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

  it('declares an icon on every entry', () => {
    const iconless = [EVENT_NAV_OVERVIEW, ...EVENT_NAV_GROUPS.flatMap((g) => g.items)]
      .filter((item) => !NAV_ICON_NAMES.includes(item.icon))
      .map((item) => item.href);
    expect(iconless).toEqual([]);
  });

  it('never repeats an icon inside one group', () => {
    // Two rows in the same group wearing the same glyph is the copy-paste the
    // old two-letter badges kept producing (`P` participants vs `PL` pools).
    // Across groups a repeat is fine and deliberate.
    for (const g of EVENT_NAV_GROUPS) {
      const icons = g.items.map((i) => i.icon);
      expect(new Set(icons).size, `duplicate icon in group "${g.key}"`).toBe(icons.length);
    }
  });
});

describe('the Workshops-only sidebar', () => {
  const workshops = applyMenuProfile(EVENT_NAV_GROUPS, ORG_NAV_ITEMS, 'workshops');
  const layout = (groups: typeof workshops.groups) =>
    groups.map((g) => [g.key, g.items.map((i) => i.href)] as const);

  it('keeps exactly Overview, Events, Org members, AI settings, Venues and Safety reports in the organisation', () => {
    expect(workshops.orgItems.map((i) => i.href)).toEqual([
      '',
      'events',
      'settings',
      'settings/ai',
      'venues',
      'fightbook-flags',
    ]);
  });

  it('keeps exactly these event entries, Schedule after Workshops, and no Competition group', () => {
    expect(layout(workshops.groups)).toEqual([
      ['people', ['persons', 'clubs', 'staff']],
      ['programme', ['workshops', 'schedule']],
      ['admin', ['notifications', 'photos', 'theme', 'archive', 'ai-assistant', 'chat']],
    ]);
  });

  it('shows Schedule once', () => {
    const hrefs = workshops.groups.flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs.filter((h) => h === 'schedule')).toHaveLength(1);
  });

  it('moves only entries that exist, into groups that exist', () => {
    const hrefs = EVENT_NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href));
    const keys = EVENT_NAV_GROUPS.map((g) => g.key);
    for (const [href, groupKey] of WORKSHOPS_MOVES) {
      expect(hrefs, href).toContain(href);
      expect(keys, groupKey).toContain(groupKey);
    }
  });

  it('hides an entry built inline only when Workshops only is picked and the entry says so', () => {
    const hidden = { inWorkshops: false };
    expect(shownIn(hidden, 'workshops')).toBe(false);
    expect(shownIn(hidden, 'everything')).toBe(true);
    expect(shownIn(hidden, undefined)).toBe(true);
    expect(shownIn({ inWorkshops: true }, 'workshops')).toBe(true);
  });

  it('Everything hands back the same arrays, so its sidebar is today’s', () => {
    const everything = applyMenuProfile(EVENT_NAV_GROUPS, ORG_NAV_ITEMS, 'everything');
    expect(everything.groups).toBe(EVENT_NAV_GROUPS);
    expect(everything.orgItems).toBe(ORG_NAV_ITEMS);
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
