import { describe, expect, it } from 'vitest';
import {
  SLOT_HEIGHT_MAX,
  SLOT_HEIGHT_MIN,
  SNAP_SLOTS,
  computeVenueGroups,
  formatSlotTime,
  hhmmToSlot,
  isoToSlot,
  minutesToSlot,
  nowSlotForDay,
  resizeStartSlot,
  slotToHHMM,
  slotToTime,
  snapSlot,
  venueColor,
  zoomToSlotHeight,
} from './schedule-grid-geometry';

const BASE = '2026-06-15';

describe('schedule-grid-geometry', () => {
  describe('venueColor', () => {
    it('returns null for no venue', () => {
      expect(venueColor(null)).toBeNull();
    });
    it('is deterministic per venue id and differs by id', () => {
      const a1 = venueColor('venue-a');
      const a2 = venueColor('venue-a');
      const b = venueColor('venue-b');
      expect(a1).toEqual(a2);
      expect(a1).not.toBeNull();
      expect(a1!.backgroundColor).toMatch(/^hsl\(/);
      expect(a1).not.toEqual(b);
    });
  });

  describe('slotToTime / isoToSlot roundtrip', () => {
    it('isoToSlot inverts slotToTime for every slot, in a fixed event tz', () => {
      for (const tz of ['Europe/Paris', 'America/New_York', 'Asia/Tokyo']) {
        for (let s = 0; s <= 100; s++) {
          expect(isoToSlot(slotToTime(s, BASE, tz), BASE, tz)).toBe(s);
        }
      }
    });

    it('anchors slot 0 at 08:00 wall-clock in the event tz (Paris summer = 06:00Z)', () => {
      expect(slotToTime(0, '2027-06-21', 'Europe/Paris')).toBe('2027-06-21T06:00:00.000Z');
    });
  });

  describe('formatSlotTime', () => {
    it('labels the hour boundaries from 08:00', () => {
      expect(formatSlotTime(0)).toBe('08:00');
      expect(formatSlotTime(12)).toBe('09:00');
      expect(formatSlotTime(13)).toBe('09:05');
    });
  });

  describe('slotToHHMM', () => {
    it('maps a slot to its HH:MM on the 08:00 axis', () => {
      expect(slotToHHMM(0)).toBe('08:00');
      expect(slotToHHMM(1)).toBe('08:05');
      expect(slotToHHMM(144)).toBe('20:00');
    });
  });

  describe('hhmmToSlot', () => {
    it('maps HH:MM back to a slot index', () => {
      expect(hhmmToSlot('08:00')).toBe(0);
      expect(hhmmToSlot('09:05')).toBe(13);
    });
    it('clamps times before the axis start to 0', () => {
      expect(hhmmToSlot('07:30')).toBe(0);
    });
    it('roundtrips with slotToHHMM', () => {
      for (let s = 0; s <= 144; s++) {
        expect(hhmmToSlot(slotToHHMM(s))).toBe(s);
      }
    });
  });

  describe('minutesToSlot', () => {
    it('floors minutes into 5-minute slots', () => {
      expect(minutesToSlot(9)).toBe(1);
      expect(minutesToSlot(10)).toBe(2);
      expect(minutesToSlot(0)).toBe(0);
    });
  });

  describe('snapSlot', () => {
    it('rounds a 5-min slot to the nearest 15-min boundary', () => {
      expect(SNAP_SLOTS).toBe(3);
      expect(snapSlot(0)).toBe(0);
      expect(snapSlot(1)).toBe(0); // 08:05 → 08:00
      expect(snapSlot(2)).toBe(3); // 08:10 → 08:15
      expect(snapSlot(3)).toBe(3); // 08:15 stays
      expect(snapSlot(4)).toBe(3); // 08:20 → 08:15
      expect(snapSlot(5)).toBe(6); // 08:25 → 08:30
      expect(snapSlot(13)).toBe(12); // 09:05 → 09:00
    });

    it('never returns a negative slot', () => {
      expect(snapSlot(-1)).toBe(0);
    });
  });

  describe('resizeStartSlot', () => {
    it('snaps the dragged start to 15 min', () => {
      expect(resizeStartSlot(2, 12)).toBe(3); // drag to 08:10 → 08:15
      expect(resizeStartSlot(7, 12)).toBe(6); // drag to 08:35 → 08:30
    });

    it('clamps to at least one slot before the fixed end', () => {
      expect(resizeStartSlot(20, 12)).toBe(11); // can't pass/meet the end
      expect(resizeStartSlot(12, 12)).toBe(11);
    });

    it('clamps to 0 at the top', () => {
      expect(resizeStartSlot(-3, 12)).toBe(0);
    });
  });

  describe('nowSlotForDay', () => {
    const PARIS = 'Europe/Paris';

    it('returns the slot for an instant on the day, in the event zone', () => {
      // 2027-06-21 09:30 Paris (CEST = UTC+2) → 07:30Z; 90 min past 08:00 → slot 18.
      expect(nowSlotForDay('2027-06-21T07:30:00.000Z', '2027-06-21', PARIS)).toBe(18);
    });

    it('returns null when the instant falls on another day in the zone', () => {
      // 2027-06-21 23:00Z is already 2027-06-22 01:00 in Paris.
      expect(nowSlotForDay('2027-06-21T23:00:00.000Z', '2027-06-21', PARIS)).toBeNull();
    });

    it('returns null before the grid start hour', () => {
      // 06:30 Paris = 04:30Z, before 08:00 → negative slot → null.
      expect(nowSlotForDay('2027-06-21T04:30:00.000Z', '2027-06-21', PARIS)).toBeNull();
    });

    it('returns null on malformed input', () => {
      expect(nowSlotForDay('not-a-date', '2027-06-21', PARIS)).toBeNull();
    });
  });

  describe('configurable start hour', () => {
    const PARIS = 'Europe/Paris';
    it('slotToHHMM / hhmmToSlot honour a non-default start hour', () => {
      expect(slotToHHMM(0, 9)).toBe('09:00');
      expect(slotToHHMM(12, 9)).toBe('10:00');
      expect(hhmmToSlot('09:00', 9)).toBe(0);
      expect(hhmmToSlot('10:00', 9)).toBe(12);
    });
    it('slotToTime / isoToSlot round-trip with a start hour', () => {
      for (let s = 0; s <= 50; s++) {
        expect(isoToSlot(slotToTime(s, BASE, PARIS, 9), BASE, PARIS, 9)).toBe(s);
      }
    });
    it('anchors slot 0 at the start hour wall-clock (09:00 Paris summer = 07:00Z)', () => {
      expect(slotToTime(0, '2027-06-21', PARIS, 9)).toBe('2027-06-21T07:00:00.000Z');
    });
    it('nowSlotForDay measures from the start hour', () => {
      // 09:30 Paris (07:30Z) with a 09:00 axis → 30 min → slot 6.
      expect(nowSlotForDay('2027-06-21T07:30:00.000Z', '2027-06-21', PARIS, 9)).toBe(6);
    });
  });

  describe('zoomToSlotHeight', () => {
    it('keeps an in-range height (rounded)', () => {
      expect(zoomToSlotHeight(16)).toBe(16);
      expect(zoomToSlotHeight(20.4)).toBe(20);
    });
    it('clamps to the min and max', () => {
      expect(zoomToSlotHeight(2)).toBe(SLOT_HEIGHT_MIN);
      expect(zoomToSlotHeight(999)).toBe(SLOT_HEIGHT_MAX);
    });
  });

  describe('computeVenueGroups', () => {
    it('merges consecutive same-venue lices and splits on change', () => {
      const groups = computeVenueGroups([
        { venues: { id: 'v1', name: 'CSL' } },
        { venues: { id: 'v1', name: 'CSL' } },
        { venues: null },
        { venues: { id: 'v2', name: 'Annex' } },
      ]);
      expect(groups).toEqual([
        { venueId: 'v1', venueName: 'CSL', startIndex: 0, span: 2 },
        { venueId: null, venueName: null, startIndex: 2, span: 1 },
        { venueId: 'v2', venueName: 'Annex', startIndex: 3, span: 1 },
      ]);
    });
  });
});
