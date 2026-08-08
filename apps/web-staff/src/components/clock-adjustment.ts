/**
 * Display-anchored clock adjustment for the Match-corrections drawer.
 *
 * The `adjust_time` API mutates ELAPSED active ms, but the operator
 * reasons about the DISPLAYED clock. In countdown mode the two are
 * inverted (display = limit − elapsed), and when the clock ran past
 * zero the display is pinned at 0:00 while elapsed keeps a hidden
 * overshoot — a naive ±delta then changes nothing on screen (the
 * "silent fail"). So: compute the target DISPLAY first (clamped to
 * [0, limit]), derive the elapsed that produces it, and return the
 * difference as the adjustment.
 *
 * Pure: no React, no I/O.
 */
export function clockAdjustmentMs({
  timerMode,
  direction,
  seconds,
  elapsedMs,
  limitMs,
}: {
  timerMode: 'countdown' | 'countup';
  direction: 'add' | 'subtract';
  seconds: number;
  elapsedMs: number;
  limitMs: number | null;
}): number {
  const deltaMs = seconds * 1000;

  if (timerMode !== 'countdown' || limitMs === null) {
    // Display IS elapsed — apply directly.
    return direction === 'add' ? deltaMs : -deltaMs;
  }

  const shownRemaining = Math.max(0, limitMs - elapsedMs);
  const targetRemaining = Math.min(
    limitMs,
    Math.max(0, direction === 'add' ? shownRemaining + deltaMs : shownRemaining - deltaMs),
  );
  const targetElapsed = limitMs - targetRemaining;
  return targetElapsed - elapsedMs;
}
