import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { localeToBcp47 } from '@myclash/time';
import { I18nProvider } from '../../../src/i18n/I18nProvider';
import { TrendChart, type TrendSample } from './TrendChart';
import { axisTicks, windowDomain } from './trend-geometry';

/**
 * Rendered through the app's own provider because the chart calls `useI18n()`.
 * Static markup only — there is no testing-library in this repo, so the pointer
 * and keyboard wiring is checked in the browser. What is asserted here is
 * everything the chart draws before anyone touches it: the labels, the four
 * series colours, and the clock under them.
 */
const SINCE = '2026-08-16T00:00:00.000Z';
const QUARTER = 900_000;

function samples(count: number, overrides: Partial<TrendSample> = {}): TrendSample[] {
  return Array.from({ length: count }, (_, i) => ({
    sampledAt: new Date(Date.parse(SINCE) + i * QUARTER).toISOString(),
    connInUse: 20 + i,
    connMax: 100,
    redisUsedBytes: 10_000 + i * 100,
    redisMaxBytes: 1_000_000,
    queueWaiting: i,
    diskUsePct: 80 + (i % 3),
    ...overrides,
  }));
}

const render = (nodes: TrendSample[]) =>
  renderToStaticMarkup(
    <I18nProvider locale="en">
      <TrendChart samples={nodes} since={SINCE} windowHours={24} />
    </I18nProvider>,
  );

describe('TrendChart', () => {
  it('names the subsystem of every row', () => {
    const html = render(samples(8));
    for (const label of ['DB connections', 'Redis memory', 'Queue waiting', 'Disk used']) {
      expect(html).toContain(label);
    }
  });

  it('gives each series its own colour, once', () => {
    const html = render(samples(8));
    for (const n of [1, 2, 3, 4]) {
      expect(html.match(new RegExp(`text-chart-${n}\\b`, 'g'))).toHaveLength(1);
      // The label dot: one per row, plus the tooltip's — which is not rendered
      // until something is hovered.
      expect(html.match(new RegExp(`bg-chart-${n}\\b`, 'g'))).toHaveLength(1);
    }
  });

  it('puts a clock under the strip, spanning the whole window', () => {
    const html = render(samples(8));
    const clock = new Intl.DateTimeFormat(localeToBcp47('en'), {
      hour: '2-digit',
      minute: '2-digit',
    });
    // Re-derived rather than hardcoded: the labels are in the reader's zone,
    // and a fixture written in one zone would only pass on that machine.
    for (const tick of axisTicks(windowDomain(SINCE, 24), 5)) {
      expect(html).toContain(clock.format(new Date(tick)));
    }
  });

  it('draws one line per reporting series', () => {
    expect(render(samples(8)).match(/<path/g)).toHaveLength(4);
  });

  it('draws no line for a metric that never reported', () => {
    // Redis with maxmemory 0 means "unlimited": there is no percentage to plot,
    // and a flat line at zero would read as an empty cache.
    const html = render(samples(8, { redisMaxBytes: 0 }));
    expect(html.match(/<path/g)).toHaveLength(3);
    expect(html).toContain('Redis memory'); // the row stays, with no line in it
  });

  it('shows no crosshair before anyone points at it', () => {
    const html = render(samples(8));
    expect(html).not.toContain('role="status"');
  });
});
