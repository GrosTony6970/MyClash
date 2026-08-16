/**
 * Geometry for the runtime-health trend strip.
 *
 * Pure on purpose. The strip is an inline SVG in a client component, which is
 * hard to assert against; every decision that can be wrong — where a point sits
 * on the clock, where a line breaks, which sample the cursor is nearest — lives
 * here instead, where a test can hold it still.
 *
 * The load-bearing rule: x is TIME, never sample index. The collector runs
 * every few minutes but misses ticks (a restart, a slow probe), and index
 * spacing silently closes those holes — the surviving samples slide together
 * and the shape reads as continuous history. That was tolerable while the strip
 * had no axis. With clock labels under it, it would be a lie.
 */

/** A half-open window on the clock, in epoch ms. */
export interface Domain {
  start: number;
  end: number;
}

/** One reading of one metric. `v == null` means the collector had no answer. */
export interface Reading {
  t: number;
  v: number | null;
}

const HOUR_MS = 3_600_000;

/**
 * The window the server was asked for, anchored on the `since` it answered with.
 *
 * Not `[first sample, last sample]`: a stack that has been up for two hours has
 * two hours of history, and stretching that across the full width would draw a
 * busy 24-hour picture out of 8 samples. The empty left of the strip is real
 * information. The end is `since + hours` rather than the client's clock, so a
 * skewed browser cannot shift the axis under the data.
 */
export function windowDomain(since: string, hours: number): Domain {
  const start = Date.parse(since);
  if (Number.isNaN(start)) throw new Error(`trend: unparseable since "${since}"`);
  return { start, end: start + hours * HOUR_MS };
}

/**
 * Percentage of a capacity pair, or null when either side is missing.
 * A zero denominator yields null rather than 0: Redis reports maxmemory 0 for
 * "unlimited", and drawing that as 0% would read as healthy headroom on a chart
 * where the number is simply not meaningful.
 */
export function ratioPct(used: number | null, max: number | null): number | null {
  if (used == null || max == null || max <= 0) return null;
  return (used / max) * 100;
}

/** Position of a timestamp in the window, 0..1, clamped to the edges. */
export function xFraction(t: number, d: Domain): number {
  const span = d.end - d.start;
  if (span <= 0) return 0;
  return Math.min(1, Math.max(0, (t - d.start) / span));
}

/**
 * How far apart two samples may be before the line between them is a guess.
 *
 * Derived from the data because the client is never told the collector's
 * cadence — it lives in the alert settings, not in the series response. The
 * median delta is robust to the very holes we are trying to find; 2.5x it
 * tolerates one skipped tick and breaks on two. The 2-minute floor stops a
 * burst of near-simultaneous samples from making every normal interval look
 * like an outage.
 */
export function gapThresholdMs(times: number[]): number {
  const deltas: number[] = [];
  for (let i = 1; i < times.length; i++) deltas.push(times[i]! - times[i - 1]!);
  if (deltas.length === 0) return Number.POSITIVE_INFINITY;
  deltas.sort((a, b) => a - b);
  const mid = Math.floor(deltas.length / 2);
  const median = deltas.length % 2 === 1 ? deltas[mid]! : (deltas[mid - 1]! + deltas[mid]!) / 2;
  return Math.max(median * 2.5, 120_000);
}

/** Vertical extent of a series, with a 1-unit floor so a flat line divides. */
export function valueSpan(values: Array<number | null>): { min: number; span: number } | null {
  const points = values.filter((v): v is number => v != null);
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  // A flat series has zero range; a 1-unit span keeps it drawn mid-height
  // instead of dividing by zero.
  return { min, span: max - min || 1 };
}

/**
 * SVG path `d` strings for one series — one per unbroken run of readings.
 *
 * A run ends for two reasons, and they are different failures:
 *   - a `null` reading: the collector answered "I do not know". Drawing that as
 *     zero would put a cliff to the floor on the chart and read as an outage in
 *     the metric itself.
 *   - a time gap: the collector did not answer at all. There is no evidence for
 *     the straight line that would otherwise span those hours.
 */
export function buildSegments(
  readings: Reading[],
  domain: Domain,
  opts: { width: number; height: number; maxGapMs: number },
): string[] {
  const extent = valueSpan(readings.map((r) => r.v));
  if (!extent) return [];

  const segments: string[] = [];
  let current: string[] = [];
  let prevT: number | null = null;

  const flush = () => {
    if (current.length > 1) segments.push(current.join(' '));
    current = [];
  };

  for (const { t, v } of readings) {
    if (v == null) {
      flush();
      prevT = null;
      continue;
    }
    if (prevT != null && t - prevT > opts.maxGapMs) flush();
    const x = (xFraction(t, domain) * opts.width).toFixed(2);
    const y = (opts.height - ((v - extent.min) / extent.span) * opts.height).toFixed(2);
    current.push(`${current.length === 0 ? 'M' : 'L'}${x},${y}`);
    prevT = t;
  }
  flush();
  return segments;
}

/** Where one reading sits in the viewBox, or null when there is nothing to plot. */
export function pointAt(
  readings: Reading[],
  index: number,
  domain: Domain,
  opts: { width: number; height: number },
): { x: number; y: number } | null {
  const reading = readings[index];
  if (!reading || reading.v == null) return null;
  const extent = valueSpan(readings.map((r) => r.v));
  if (!extent) return null;
  return {
    x: xFraction(reading.t, domain) * opts.width,
    y: opts.height - ((reading.v - extent.min) / extent.span) * opts.height,
  };
}

/** Evenly spaced tick times across the window, ends included. */
export function axisTicks(domain: Domain, count: number): number[] {
  if (count < 2) return [domain.start];
  const step = (domain.end - domain.start) / (count - 1);
  return Array.from({ length: count }, (_, i) => Math.round(domain.start + i * step));
}

/**
 * The sample nearest a pointer position, by time.
 *
 * Nearest rather than "the one under the cursor": the samples are sparse
 * against a 24-hour width, so anything else would leave dead zones where the
 * crosshair has nothing to report.
 */
export function nearestIndex(fraction: number, times: number[], domain: Domain): number | null {
  if (times.length === 0) return null;
  const target = domain.start + Math.min(1, Math.max(0, fraction)) * (domain.end - domain.start);
  let best = 0;
  let bestDistance = Math.abs(times[0]! - target);
  for (let i = 1; i < times.length; i++) {
    const distance = Math.abs(times[i]! - target);
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Where a key press moves the crosshair.
 *
 * `undefined` means the key is not ours — the caller must let it through, or
 * the strip would swallow Tab and trap the keyboard inside itself. `null` means
 * clear. Starting from the end on a first Arrow press matches the value column,
 * which already reads the latest sample.
 */
export function nextHoverIndex(
  key: string,
  current: number | null,
  count: number,
): number | null | undefined {
  const clamp = (i: number) => Math.min(count - 1, Math.max(0, i));
  const from = current ?? count - 1;
  switch (key) {
    case 'ArrowLeft':
      return clamp(from - 1);
    case 'ArrowRight':
      return clamp(from + 1);
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    case 'Escape':
      return null;
    default:
      return undefined;
  }
}

export interface SeriesSpec {
  label: string;
  values: Array<number | null>;
  format: (v: number) => string;
}

export interface HoverRow {
  label: string;
  value: string;
}

/** The readings of every series at one sample, formatted for the tooltip. */
export function readingsAt(series: SeriesSpec[], index: number): HoverRow[] {
  return series.map((s) => {
    const v = s.values[index];
    return { label: s.label, value: v == null ? '—' : s.format(v) };
  });
}

/** The most recent reading of a series, or null when it never reported. */
export function latestValue(values: Array<number | null>): number | null {
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i];
    if (v != null) return v;
  }
  return null;
}
