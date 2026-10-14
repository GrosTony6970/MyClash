import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { zoomToSlotHeight } from '@myclash/schedule-core';
import { PANEL_DEFAULT_WIDTH, PANEL_MAX_WIDTH, PANEL_MIN_WIDTH } from './panel-width';
import {
  panelCollapsedCodec,
  panelWidthCodec,
  venueFilterCodec,
  viewModeCodec,
  zoomCodec,
  type PrefCodec,
} from './useSchedulePrefs';

/**
 * These cover the string boundary the preferences hook sits on. The hook itself
 * is React and needs a renderer; the codecs are where the behaviour lives, and
 * they are where the old read effects' guards were reproduced.
 *
 * The round-trip cases are the load-bearing ones. The store holds the *rendered*
 * value (a pixel width, a pixel slot height) and re-clamps it on the way back
 * in, so `parse(serialize(v)) === v` is what lets one localStorage key serve as
 * the state instead of a mirror that can drift.
 */

// Every codec falls back the same way when nothing usable is stored.
const codecs: Array<[string, PrefCodec<unknown>]> = [
  ['panelCollapsed', panelCollapsedCodec as PrefCodec<unknown>],
  ['panelWidth', panelWidthCodec as PrefCodec<unknown>],
  ['zoom', zoomCodec as PrefCodec<unknown>],
  ['venueFilter', venueFilterCodec as PrefCodec<unknown>],
  ['viewMode', viewModeCodec as PrefCodec<unknown>],
];

describe('schedule preference codecs', () => {
  it('gives every preference a distinct storage key under one namespace', () => {
    const keys = codecs.map(([, codec]) => codec.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key.startsWith('myclash.schedule.')).toBe(true);
  });

  describe('panelCollapsed', () => {
    it("treats only '1' as collapsed, mirroring the old read effect", () => {
      expect(panelCollapsedCodec.parse('1')).toBe(true);
      expect(panelCollapsedCodec.parse('0')).toBe(false);
      expect(panelCollapsedCodec.parse('true')).toBe(false);
      expect(panelCollapsedCodec.fallback).toBe(false);
    });

    it('round-trips both states', () => {
      for (const value of [true, false]) {
        expect(panelCollapsedCodec.parse(panelCollapsedCodec.serialize(value))).toBe(value);
      }
    });
  });

  describe('panelWidth', () => {
    it('rejects what the old `Number.isFinite(stored) && stored > 0` guard rejected', () => {
      for (const raw of ['', ' ', 'wide', 'NaN', '0', '-40']) {
        expect(panelWidthCodec.parse(raw)).toBeNull();
      }
    });

    it('clamps a stored width into the usable band', () => {
      expect(panelWidthCodec.parse('10')).toBe(PANEL_MIN_WIDTH);
      expect(panelWidthCodec.parse('99999')).toBe(PANEL_MAX_WIDTH);
    });

    it('round-trips every in-band width, so the store can hold pixels', () => {
      for (const width of [PANEL_MIN_WIDTH, PANEL_DEFAULT_WIDTH, 421, PANEL_MAX_WIDTH]) {
        expect(panelWidthCodec.parse(panelWidthCodec.serialize(width))).toBe(width);
      }
    });
  });

  describe('zoom', () => {
    const minHeight = zoomToSlotHeight(-9999);
    const maxHeight = zoomToSlotHeight(9999);

    it('rejects what the old read effect rejected', () => {
      for (const raw of ['', ' ', 'tall', 'NaN', '0', '-16']) {
        expect(zoomCodec.parse(raw)).toBeNull();
      }
    });

    it('clamps a stored slot height into the zoom band', () => {
      expect(zoomCodec.parse('1')).toBe(minHeight);
      expect(zoomCodec.parse('9999')).toBe(maxHeight);
    });

    it('round-trips every in-band slot height', () => {
      for (let height = minHeight; height <= maxHeight; height++) {
        expect(zoomCodec.parse(zoomCodec.serialize(height))).toBe(height);
      }
    });

    it('opens at a height inside the band', () => {
      expect(zoomCodec.fallback).toBeGreaterThanOrEqual(minHeight);
      expect(zoomCodec.fallback).toBeLessThanOrEqual(maxHeight);
    });
  });

  describe('venueFilter', () => {
    it('treats an empty string as unset, mirroring the old `if (stored)` guard', () => {
      expect(venueFilterCodec.parse('')).toBeNull();
      expect(venueFilterCodec.fallback).toBe('all');
    });

    it('round-trips the three shapes the filter takes', () => {
      for (const value of ['all', 'none', 'b3f1c0de-0000-4000-8000-000000000000']) {
        expect(venueFilterCodec.parse(venueFilterCodec.serialize(value))).toBe(value);
      }
    });
  });

  // Blocks / Detailed was the one board setting a reload forgot (quick win O26).
  describe('viewMode', () => {
    it('opens on the readable block view when nothing is stored', () => {
      expect(viewModeCodec.fallback).toBe('blocks');
    });

    it('round-trips both views', () => {
      for (const value of ['blocks', 'grid'] as const) {
        expect(viewModeCodec.parse(viewModeCodec.serialize(value))).toBe(value);
      }
    });

    it('treats any other stored word as unset', () => {
      for (const raw of ['', 'Grid', 'timeline', '1']) expect(viewModeCodec.parse(raw)).toBeNull();
    });

    // A text pin: no test mounts the board (it reads the API and realtime), so this is
    // what holds that it takes its view from the kept preference, not from a useState.
    it('is what the board reads', () => {
      const grid = readFileSync(join(__dirname, 'grid.tsx'), 'utf8');
      expect(grid).toMatch(/viewMode,\s+setViewMode,\s+\} = useSchedulePrefs\(\);/);
      expect(grid).not.toMatch(/useState<'blocks' \| 'grid'>/);
    });
  });
});
