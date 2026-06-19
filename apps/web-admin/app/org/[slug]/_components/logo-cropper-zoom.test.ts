import { describe, expect, it } from 'vitest';
import { ZOOM_OUT_FLOOR, computeMinZoom } from './logo-cropper-zoom';

describe('computeMinZoom', () => {
  it('returns the zoom-out floor when sizes are missing or invalid', () => {
    expect(computeMinZoom(null, null)).toBe(ZOOM_OUT_FLOOR);
    expect(computeMinZoom({ width: 0, height: 100 }, { width: 320, height: 320 })).toBe(
      ZOOM_OUT_FLOOR,
    );
    expect(computeMinZoom({ width: Number.NaN, height: 100 }, { width: 320, height: 320 })).toBe(
      ZOOM_OUT_FLOOR,
    );
    expect(computeMinZoom({ width: 512, height: 128 }, null)).toBe(ZOOM_OUT_FLOOR);
  });

  it('floors a wide logo that fits above the floor at the floor', () => {
    // fit = min(320/512, 320/128) = 0.625 → floored to 0.5 (whole logo still fits).
    expect(computeMinZoom({ width: 512, height: 128 }, { width: 320, height: 320 })).toBe(0.5);
  });

  it('returns the exact fit for a very wide logo below the floor', () => {
    // fit = min(320/1000, 320/100) = 0.32 → below floor, so exact fit.
    expect(computeMinZoom({ width: 1000, height: 100 }, { width: 320, height: 320 })).toBeCloseTo(
      0.32,
      5,
    );
  });

  it('keeps zoom-out room (the floor) for a square / small logo', () => {
    // fit = 1.6 → floored to 0.5 so the operator can still shrink it.
    expect(computeMinZoom({ width: 200, height: 200 }, { width: 320, height: 320 })).toBe(0.5);
  });
});
