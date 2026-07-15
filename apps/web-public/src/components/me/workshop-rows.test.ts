import { describe, expect, it } from 'vitest';
import { buildWorkshopRows } from './workshop-rows';
import type { MyEventWorkshopTeaching, WorkshopEnrollment } from './types';

const teach = (over: Partial<MyEventWorkshopTeaching> = {}): MyEventWorkshopTeaching => ({
  workshopId: over.workshopId ?? 'w-t',
  workshopSlug: over.workshopSlug ?? 'taught',
  workshopName: over.workshopName ?? 'Taught workshop',
  sessionStart: over.sessionStart ?? null,
  sessionEnd: over.sessionEnd ?? null,
  location: over.location ?? null,
});

const attend = (over: Partial<WorkshopEnrollment> = {}): WorkshopEnrollment => ({
  workshopId: over.workshopId ?? 's-a',
  workshopSlug: over.workshopSlug ?? 'attended',
  workshopName: over.workshopName ?? 'Attended workshop',
  sessionStart: over.sessionStart ?? null,
  sessionEnd: over.sessionEnd ?? null,
  location: over.location ?? null,
});

describe('buildWorkshopRows', () => {
  it('tags teaching vs attending and points each at the right href', () => {
    const rows = buildWorkshopRows(
      [teach({ workshopId: 'w1', sessionStart: '2026-06-01T09:00:00Z' })],
      [attend({ workshopId: 's1', sessionStart: '2026-06-01T11:00:00Z' })],
      'fosse-2027',
    );
    expect(rows.map((r) => [r.involvement, r.href])).toEqual([
      ['teaching', '/me/instructor'],
      ['attending', '/me/events/fosse-2027/workshops'],
    ]);
    expect(rows.map((r) => r.key)).toEqual(['teach-w1', 'att-s1']);
  });

  it('sorts by session start with unscheduled (null start) last', () => {
    const rows = buildWorkshopRows(
      [
        teach({ workshopId: 'late', workshopSlug: 'late', sessionStart: '2026-06-01T15:00:00Z' }),
        teach({ workshopId: 'tbd', workshopSlug: 'tbd', sessionStart: null }),
      ],
      [
        attend({
          workshopId: 'early',
          workshopSlug: 'early',
          sessionStart: '2026-06-01T08:00:00Z',
        }),
      ],
      'e',
    );
    expect(rows.map((r) => r.key)).toEqual(['att-early', 'teach-late', 'teach-tbd']);
  });

  it('dedupes a workshop the user both leads and attends, keeping the teaching row', () => {
    const rows = buildWorkshopRows(
      [teach({ workshopId: 'w9', workshopSlug: 'both', sessionStart: '2026-06-01T09:00:00Z' })],
      [attend({ workshopId: 's9', workshopSlug: 'both', sessionStart: '2026-06-01T09:00:00Z' })],
      'e',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.involvement).toBe('teaching');
  });

  it('keeps an attending row with no slug (cannot collide with a taught slug)', () => {
    const rows = buildWorkshopRows(
      [teach({ workshopSlug: 'taught' })],
      [attend({ workshopId: 's0', workshopSlug: null })],
      'e',
    );
    expect(rows.map((r) => r.involvement)).toEqual(['teaching', 'attending']);
  });

  it('returns an empty list when there is nothing to show', () => {
    expect(buildWorkshopRows([], [], 'e')).toEqual([]);
  });
});
