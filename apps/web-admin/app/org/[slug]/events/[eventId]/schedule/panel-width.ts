/**
 * Bounds + clamp for the schedule sidebar's drag-to-resize width. Keeps the
 * Unscheduled/Configure panel between a usable minimum and a sane maximum so a
 * stored/dragged value can never collapse or eat the whole canvas.
 *
 * Pure: no React, no I/O.
 */

export const PANEL_MIN_WIDTH = 240;
export const PANEL_MAX_WIDTH = 560;
export const PANEL_DEFAULT_WIDTH = 320; // matches the old Tailwind w-80

export function clampPanelWidth(
  px: number,
  min: number = PANEL_MIN_WIDTH,
  max: number = PANEL_MAX_WIDTH,
): number {
  return Math.max(min, Math.min(max, px));
}
