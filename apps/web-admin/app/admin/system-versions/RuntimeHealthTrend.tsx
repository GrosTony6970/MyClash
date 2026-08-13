'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import { getPublicApiUrl } from '@/lib/api-url';

interface Sample {
  sampledAt: string;
  connInUse: number | null;
  connMax: number | null;
  redisUsedBytes: number | null;
  redisMaxBytes: number | null;
  queueWaiting: number | null;
  diskUsePct: number | null;
}

interface SeriesResponse {
  since: string;
  samples: Sample[];
}

const API = getPublicApiUrl();
const WINDOW_HOURS = 24;

/**
 * Percentage of a capacity pair, or null when either side is missing.
 * A zero denominator yields null rather than 0: Redis reports maxmemory 0 for
 * "unlimited", and drawing that as 0% would read as healthy headroom on a chart
 * where the number is simply not meaningful.
 */
function ratioPct(used: number | null, max: number | null): number | null {
  if (used == null || max == null || max <= 0) return null;
  return (used / max) * 100;
}

/**
 * Inline SVG rather than a charting library: packages/ui is CJS and does not
 * tree-shake, so a barrel import ships whole.
 *
 * Nulls are gaps, not zeroes — a failed collector must not draw a cliff to the
 * floor that reads as an outage in the metric itself.
 */
function Sparkline({ values, label }: { values: Array<number | null>; label: string }) {
  const points = values.filter((v): v is number => v != null);
  if (points.length < 2) return null;

  const max = Math.max(...points);
  const min = Math.min(...points);
  // A flat series has zero range; a 1-unit span keeps it drawn mid-height
  // instead of dividing by zero.
  const span = max - min || 1;
  const width = 100;
  const height = 24;
  const stepX = width / (values.length - 1);

  // Each unbroken run of readings becomes its own path, so gaps stay gaps.
  const segments: string[] = [];
  let current: string[] = [];
  values.forEach((value, i) => {
    if (value == null) {
      if (current.length > 1) segments.push(current.join(' '));
      current = [];
      return;
    }
    const x = (i * stepX).toFixed(2);
    const y = (height - ((value - min) / span) * height).toFixed(2);
    current.push(`${current.length === 0 ? 'M' : 'L'}${x},${y}`);
  });
  if (current.length > 1) segments.push(current.join(' '));

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="h-6 w-full text-accent"
      role="img"
      aria-label={label}
    >
      {segments.map((d) => (
        <path
          key={d}
          d={d}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

function TrendRow({
  label,
  values,
  format,
}: {
  label: string;
  values: Array<number | null>;
  format: (v: number) => string;
}) {
  const latest = [...values].reverse().find((v): v is number => v != null);
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 text-xs text-muted">{label}</span>
      <span className="min-w-0 flex-1">
        <Sparkline values={values} label={label} />
      </span>
      <span className="w-16 shrink-0 text-right font-mono text-xs text-foreground-secondary">
        {latest == null ? '—' : format(latest)}
      </span>
    </div>
  );
}

export function RuntimeHealthTrend() {
  const { t } = useI18n();
  const [samples, setSamples] = useState<Sample[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API}/api/v1/admin/system/runtime-health/series?hours=${WINDOW_HOURS}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('series');
        const body = (await res.json()) as SeriesResponse;
        setSamples(body.samples);
      })
      .catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === 'AbortError')) setFailed(true);
      });
    return () => controller.abort();
  }, []);

  if (failed) {
    return (
      <div className="border-t border-border px-4 py-3 text-xs text-muted">
        {t('admin.systemVersions.runtimeHealth.trend.loadError')}
      </div>
    );
  }

  if (!samples) return null;

  // Two points are the minimum that can show a direction. Below that the strip
  // would be an empty frame implying the feature is broken rather than young.
  if (samples.length < 2) {
    return (
      <div className="border-t border-border px-4 py-3 text-xs text-muted">
        {t('admin.systemVersions.runtimeHealth.trend.empty')}
      </div>
    );
  }

  const pct = (v: number) => `${v.toFixed(0)} %`;

  return (
    <div className="border-t border-border px-4 py-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">
          {t('admin.systemVersions.runtimeHealth.trend.title')}
        </h3>
        <span className="text-xs text-muted">
          {t('admin.systemVersions.runtimeHealth.trend.window')}
        </span>
      </div>
      <div className="space-y-2">
        <TrendRow
          label={t('admin.systemVersions.runtimeHealth.db.connections')}
          values={samples.map((s) => ratioPct(s.connInUse, s.connMax))}
          format={pct}
        />
        <TrendRow
          label={t('admin.systemVersions.runtimeHealth.redis.memory')}
          values={samples.map((s) => ratioPct(s.redisUsedBytes, s.redisMaxBytes))}
          format={pct}
        />
        <TrendRow
          label={t('admin.systemVersions.runtimeHealth.queues.waiting')}
          values={samples.map((s) => s.queueWaiting)}
          format={(v) => String(Math.round(v))}
        />
        <TrendRow
          label={t('admin.systemVersions.runtimeHealth.disk.used')}
          values={samples.map((s) => s.diskUsePct)}
          format={pct}
        />
      </div>
      <p className="mt-2 text-xs text-muted">
        {t('admin.systemVersions.runtimeHealth.trend.samples')}: {samples.length}
      </p>
    </div>
  );
}
