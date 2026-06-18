import { describe, expect, it } from 'vitest';
import { PANEL_MAX_WIDTH, PANEL_MIN_WIDTH, clampPanelWidth } from './panel-width';

describe('clampPanelWidth', () => {
  it('passes a width that is already in range', () => {
    expect(clampPanelWidth(360)).toBe(360);
  });

  it('clamps below the minimum', () => {
    expect(clampPanelWidth(PANEL_MIN_WIDTH - 50)).toBe(PANEL_MIN_WIDTH);
    expect(clampPanelWidth(0)).toBe(PANEL_MIN_WIDTH);
    expect(clampPanelWidth(-100)).toBe(PANEL_MIN_WIDTH);
  });

  it('clamps above the maximum', () => {
    expect(clampPanelWidth(PANEL_MAX_WIDTH + 200)).toBe(PANEL_MAX_WIDTH);
  });

  it('accepts explicit bounds', () => {
    expect(clampPanelWidth(500, 100, 400)).toBe(400);
    expect(clampPanelWidth(50, 100, 400)).toBe(100);
  });
});
