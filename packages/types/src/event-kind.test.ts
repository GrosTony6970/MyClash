import { describe, expect, it } from 'vitest';
import {
  allowsDirectHardDelete,
  allowsRatingsExport,
  announcesOnPublish,
  asEventKind,
  countsAsPlatformActivity,
  countsTowardStats,
  DEFAULT_EVENT_KIND,
  EVENT_KINDS,
  isPubliclyVisible,
  type EventKind,
} from './event-kind';

describe('asEventKind', () => {
  it('passes through every known kind', () => {
    for (const kind of EVENT_KINDS) {
      expect(asEventKind(kind)).toBe(kind);
    }
  });

  it('falls back to standard for anything unrecognised', () => {
    expect(asEventKind(null)).toBe('standard');
    expect(asEventKind(undefined)).toBe('standard');
    expect(asEventKind('')).toBe('standard');
    expect(asEventKind('Club')).toBe('standard'); // case-sensitive on purpose
    expect(asEventKind('seminar')).toBe('standard');
    expect(asEventKind(42)).toBe('standard');
    expect(asEventKind({ kind: 'club' })).toBe('standard');
  });

  it('fails visible, not hidden — a corrupt value never erases an event', () => {
    // The fallback direction is load-bearing: defaulting to 'test' would make
    // one bad value silently drop an event from every public surface.
    expect(isPubliclyVisible(asEventKind('garbage'))).toBe(true);
  });

  it('agrees with DEFAULT_EVENT_KIND', () => {
    expect(asEventKind(undefined)).toBe(DEFAULT_EVENT_KIND);
  });
});

describe('event kind semantics matrix', () => {
  // One row per kind, one column per predicate. This table IS the feature's
  // acceptance criteria — if a behaviour changes, it changes here first.
  const matrix: Array<{
    kind: EventKind;
    publiclyVisible: boolean;
    countsTowardStats: boolean;
    platformActivity: boolean;
    directHardDelete: boolean;
    ratingsExport: boolean;
    announces: boolean;
  }> = [
    {
      kind: 'standard',
      publiclyVisible: true,
      countsTowardStats: true,
      platformActivity: true,
      directHardDelete: false,
      ratingsExport: true,
      announces: true,
    },
    {
      kind: 'test',
      publiclyVisible: false,
      countsTowardStats: false,
      platformActivity: false,
      directHardDelete: true,
      ratingsExport: false,
      announces: false,
    },
    {
      kind: 'club',
      publiclyVisible: true,
      countsTowardStats: false,
      platformActivity: true,
      directHardDelete: true,
      ratingsExport: false,
      announces: false,
    },
  ];

  for (const row of matrix) {
    describe(row.kind, () => {
      it(`is ${row.publiclyVisible ? '' : 'not '}publicly visible`, () => {
        expect(isPubliclyVisible(row.kind)).toBe(row.publiclyVisible);
      });

      it(`does ${row.countsTowardStats ? '' : 'not '}count toward statistics`, () => {
        expect(countsTowardStats(row.kind)).toBe(row.countsTowardStats);
      });

      it(`is ${row.platformActivity ? '' : 'not '}counted as platform activity`, () => {
        expect(countsAsPlatformActivity(row.kind)).toBe(row.platformActivity);
      });

      it(`does ${row.directHardDelete ? '' : 'not '}allow direct hard delete`, () => {
        expect(allowsDirectHardDelete(row.kind)).toBe(row.directHardDelete);
      });

      it(`does ${row.ratingsExport ? '' : 'not '}allow a ratings export`, () => {
        expect(allowsRatingsExport(row.kind)).toBe(row.ratingsExport);
      });

      it(`does ${row.announces ? '' : 'not '}announce on publish`, () => {
        expect(announcesOnPublish(row.kind)).toBe(row.announces);
      });
    });
  }

  it('covers every declared kind', () => {
    expect(matrix.map((row) => row.kind).sort()).toEqual([...EVENT_KINDS].sort());
  });
});

describe('the deliberate predicate divergences', () => {
  // These three assertions exist to break a "these are all the same, let's
  // collapse them" refactor. Each pair below encodes a product decision.

  it('club events are platform activity but NOT rated results', () => {
    expect(countsAsPlatformActivity('club')).toBe(true);
    expect(countsTowardStats('club')).toBe(false);
  });

  it('club events are publicly visible but NOT rated results', () => {
    expect(isPubliclyVisible('club')).toBe(true);
    expect(countsTowardStats('club')).toBe(false);
  });

  it('club events are publicly visible but stay silent on publish', () => {
    expect(isPubliclyVisible('club')).toBe(true);
    expect(announcesOnPublish('club')).toBe(false);
  });
});
