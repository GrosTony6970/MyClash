import { localeToBcp47, type AppLocale } from '@myclash/time';
import { ratioPct, type Reading } from './trend-geometry';

/** The slice of a runtime-health sample this strip plots. */
export interface TrendSample {
  sampledAt: string;
  connInUse: number | null;
  connMax: number | null;
  redisUsedBytes: number | null;
  redisMaxBytes: number | null;
  queueWaiting: number | null;
  diskUsePct: number | null;
}

/** One plotted metric: what it is called, what it reads, and how it is painted. */
export interface Series {
  label: string;
  readings: Reading[];
  format: (v: number) => string;
  /** Literal classes, not composed: Tailwind only sees class names it can read. */
  stroke: string;
  dot: string;
}

type Translate = (key: string) => string;

/**
 * The SVG user space. Fixed 100 x 24, stretched to the column with
 * preserveAspectRatio="none", so x is a straight percentage of the width and
 * the geometry can stay resolution-free.
 *
 * The consequence: nothing round may be drawn inside the SVG — a circle would
 * come out a wide ellipse — so the hover dot is positioned outside it.
 */
export const VIEW = { width: 100, height: 24 };

/** Interior gridlines, at the fractions the axis labels sit under. */
export const GRID_X = [25, 50, 75];

export const TICK_COUNT = 5;

export function formatClock(ms: number, locale: AppLocale): string {
  return new Intl.DateTimeFormat(localeToBcp47(locale), {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ms));
}

/**
 * The four metrics, in reading order.
 *
 * The labels name their subsystem — "Disk used", not "Used" — unlike the tiles
 * above, which sit under a title that already says which subsystem they are.
 */
export function buildSeries(t: Translate, samples: TrendSample[], times: number[]): Series[] {
  const pct = (v: number) => `${v.toFixed(0)} %`;
  const readings = (pick: (s: TrendSample) => number | null): Reading[] =>
    samples.map((s, i) => ({ t: times[i]!, v: pick(s) }));

  return [
    {
      label: t('admin.systemVersions.runtimeHealth.trend.rows.dbConnections'),
      readings: readings((s) => ratioPct(s.connInUse, s.connMax)),
      format: pct,
      stroke: 'text-chart-1',
      dot: 'bg-chart-1',
    },
    {
      label: t('admin.systemVersions.runtimeHealth.trend.rows.redisMemory'),
      readings: readings((s) => ratioPct(s.redisUsedBytes, s.redisMaxBytes)),
      format: pct,
      stroke: 'text-chart-2',
      dot: 'bg-chart-2',
    },
    {
      label: t('admin.systemVersions.runtimeHealth.trend.rows.queueWaiting'),
      readings: readings((s) => s.queueWaiting),
      format: (v) => String(Math.round(v)),
      stroke: 'text-chart-3',
      dot: 'bg-chart-3',
    },
    {
      label: t('admin.systemVersions.runtimeHealth.trend.rows.diskUsed'),
      readings: readings((s) => s.diskUsePct),
      format: pct,
      stroke: 'text-chart-4',
      dot: 'bg-chart-4',
    },
  ];
}
