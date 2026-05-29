/**
 * Render a count alongside an optional cap, e.g. "12 / 32" or "12"
 * when the cap is null. Used on the event-overview dashboard for the
 * Participants / Waitlist cards and the per-tournament Fighters
 * column. Keeping the format consistent ensures the operator can
 * scan the dashboard left-to-right without recalibrating on every
 * widget.
 */
export function formatCountOfMax(count: number, max: number | null): string {
  return max == null ? String(count) : `${count} / ${max}`;
}
