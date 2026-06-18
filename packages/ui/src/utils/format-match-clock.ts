/**
 * Match-clock MM:SS from accumulated active milliseconds — the time INTO the
 * match an event happened (what the scoreboard's timeline shows), not a
 * wall-clock time-of-day. Empty string for legacy rows with no captured time;
 * negatives clamp to 00:00.
 *
 * Pure: no React, no I/O. Shared by the referee scoreboard + the public view.
 */
export function formatMatchClock(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '';
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
