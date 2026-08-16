'use client';

import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import { type AppLocale } from '@myclash/time';
import {
  axisTicks,
  buildSegments,
  gapThresholdMs,
  latestValue,
  nearestIndex,
  nextHoverIndex,
  pointAt,
  readingsAt,
  windowDomain,
  type Domain,
  type HoverRow,
} from './trend-geometry';
import {
  buildSeries,
  formatClock,
  GRID_X,
  TICK_COUNT,
  VIEW,
  type Series,
  type TrendSample,
} from './trend-series';

export type { TrendSample };

/**
 * Inline SVG rather than a charting library: packages/ui is CJS and does not
 * tree-shake, so a barrel import ships whole. The geometry lives in
 * trend-geometry.ts and the series definition in trend-series.ts; what is left
 * here is the view.
 */

function Gridlines() {
  return (
    <>
      {GRID_X.map((x) => (
        <line
          key={x}
          x1={x}
          y1={0}
          x2={x}
          y2={VIEW.height}
          className="text-border"
          stroke="currentColor"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </>
  );
}

function Sparkline({
  series,
  domain,
  maxGapMs,
  hoverIndex,
}: {
  series: Series;
  domain: Domain;
  maxGapMs: number;
  hoverIndex: number | null;
}) {
  const segments = buildSegments(series.readings, domain, { ...VIEW, maxGapMs });
  if (segments.length === 0) return null;
  const dot = hoverIndex == null ? null : pointAt(series.readings, hoverIndex, domain, VIEW);

  return (
    <>
      <svg
        viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
        preserveAspectRatio="none"
        className={`h-6 w-full ${series.stroke}`}
        role="img"
        aria-label={series.label}
      >
        <Gridlines />
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
      {dot ? (
        <span
          className={`pointer-events-none absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full ${series.dot}`}
          style={{ left: `${dot.x}%`, top: `${(dot.y / VIEW.height) * 100}%` }}
        />
      ) : null}
    </>
  );
}

function SeriesLabels({ series }: { series: Series[] }) {
  return (
    <div className="w-28 shrink-0 space-y-2">
      {series.map((s) => (
        <span key={s.label} className="flex h-6 items-center gap-1.5 text-xs text-muted">
          <span className={`h-2 w-2 shrink-0 rounded-full ${s.dot}`} />
          <span className="truncate">{s.label}</span>
        </span>
      ))}
    </div>
  );
}

/**
 * The latest reading stays put while hovering — the tooltip carries the hovered
 * values, and a column that moved with the cursor would leave nothing on screen
 * saying where the metric stands right now.
 */
function LatestValues({ series }: { series: Series[] }) {
  return (
    <div className="w-16 shrink-0 space-y-2">
      {series.map((s) => {
        const latest = latestValue(s.readings.map((r) => r.v));
        return (
          <span
            key={s.label}
            className="flex h-6 items-center justify-end font-mono text-xs text-foreground-secondary"
          >
            {latest == null ? '—' : s.format(latest)}
          </span>
        );
      })}
    </div>
  );
}

function HoverTooltip({
  rows,
  dots,
  time,
  left,
}: {
  rows: HoverRow[];
  dots: string[];
  time: string;
  left: number;
}) {
  return (
    <div
      role="status"
      className="pointer-events-none absolute bottom-full z-10 mb-2 w-max -translate-x-1/2 rounded-md border border-border bg-surface px-2 py-1.5 shadow-sm"
      // Clamped rather than free: a tooltip centred on a reading near either
      // end would hang off the card.
      style={{ left: `${Math.min(88, Math.max(12, left))}%` }}
    >
      <p className="mb-1 font-mono text-[11px] text-foreground">{time}</p>
      {rows.map((row, i) => (
        <p key={row.label} className="flex items-center gap-1.5 text-[11px] text-muted">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dots[i]}`} />
          <span>{row.label}</span>
          <span className="ml-auto pl-2 font-mono text-foreground-secondary">{row.value}</span>
        </p>
      ))}
    </div>
  );
}

/** The crosshair and its readout, drawn over the plotted column. */
function HoverLayer({
  series,
  time,
  index,
  left,
}: {
  series: Series[];
  time: string;
  index: number;
  left: number;
}) {
  return (
    <>
      <span
        className="pointer-events-none absolute inset-y-0 w-px bg-foreground-secondary"
        style={{ left: `${left}%` }}
      />
      <HoverTooltip
        rows={readingsAt(
          series.map((s) => ({
            label: s.label,
            values: s.readings.map((r) => r.v),
            format: s.format,
          })),
          index,
        )}
        dots={series.map((s) => s.dot)}
        time={time}
        left={left}
      />
    </>
  );
}

function TrendAxis({ ticks, locale }: { ticks: number[]; locale: AppLocale }) {
  return (
    <div className="mt-1 flex gap-3">
      <div className="w-28 shrink-0" />
      <div className="flex min-w-0 flex-1 justify-between font-mono text-[10px] text-muted">
        {ticks.map((tick) => (
          <span key={tick}>{formatClock(tick, locale)}</span>
        ))}
      </div>
      <div className="w-16 shrink-0" />
    </div>
  );
}

interface ChartsColumnProps {
  series: Series[];
  domain: Domain;
  times: number[];
  hoverIndex: number | null;
  setHoverIndex: (index: number | null) => void;
  locale: AppLocale;
  label: string;
}

/** The strips themselves — pointer-transparent, so the column below owns the cursor. */
function Strips({
  series,
  domain,
  times,
  hoverIndex,
}: Pick<ChartsColumnProps, 'series' | 'domain' | 'times' | 'hoverIndex'>) {
  const maxGapMs = gapThresholdMs(times);
  return (
    <>
      {series.map((s) => (
        <span key={s.label} className="pointer-events-none relative block h-6">
          <Sparkline series={s} domain={domain} maxGapMs={maxGapMs} hoverIndex={hoverIndex} />
        </span>
      ))}
    </>
  );
}

/**
 * The plotted column: the hit target AND the positioning context.
 *
 * Its box is exactly the plotted area, so a pointer x needs no offset
 * arithmetic against the label and value columns, and one crosshair element
 * spans every row instead of one per strip.
 */
function ChartsColumn(props: ChartsColumnProps) {
  const { series, domain, times, hoverIndex, setHoverIndex, locale, label } = props;
  const box = useRef<HTMLDivElement>(null);
  const hoverLeft =
    hoverIndex == null
      ? 0
      : ((times[hoverIndex]! - domain.start) / (domain.end - domain.start)) * 100;

  const onPointerMove = (clientX: number) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    setHoverIndex(nearestIndex((clientX - rect.left) / rect.width, times, domain));
  };

  const onKeyDown = (event: ReactKeyboardEvent) => {
    const next = nextHoverIndex(event.key, hoverIndex, times.length);
    if (next === undefined) return;
    setHoverIndex(next);
    event.preventDefault();
  };

  return (
    <div
      ref={box}
      role="group"
      tabIndex={0}
      aria-label={label}
      className="relative min-w-0 flex-1 touch-pan-y space-y-2 outline-none focus-visible:ring-2 focus-visible:ring-accent"
      onPointerMove={(e) => onPointerMove(e.clientX)}
      onPointerLeave={() => setHoverIndex(null)}
      onBlur={() => setHoverIndex(null)}
      onKeyDown={onKeyDown}
    >
      <Strips series={series} domain={domain} times={times} hoverIndex={hoverIndex} />
      {hoverIndex == null ? null : (
        <HoverLayer
          series={series}
          time={formatClock(times[hoverIndex]!, locale)}
          index={hoverIndex}
          left={hoverLeft}
        />
      )}
    </div>
  );
}

/**
 * Four metrics over one clock, with a crosshair that reads all four at once.
 *
 * Split from RuntimeHealthTrend so it can be rendered from a test with fixed
 * samples: it fetches nothing and reaches for no app singletons.
 */
export function TrendChart({
  samples,
  since,
  windowHours,
}: {
  samples: TrendSample[];
  since: string;
  windowHours: number;
}) {
  const { t, locale } = useI18n();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const domain = windowDomain(since, windowHours);
  const times = samples.map((s) => Date.parse(s.sampledAt));
  const series = buildSeries(t, samples, times);

  return (
    <div>
      <div className="flex gap-3">
        <SeriesLabels series={series} />
        <ChartsColumn
          series={series}
          domain={domain}
          times={times}
          hoverIndex={hoverIndex}
          setHoverIndex={setHoverIndex}
          locale={locale}
          label={t('admin.systemVersions.runtimeHealth.trend.inspect')}
        />
        <LatestValues series={series} />
      </div>
      <TrendAxis ticks={axisTicks(domain, TICK_COUNT)} locale={locale} />
    </div>
  );
}
