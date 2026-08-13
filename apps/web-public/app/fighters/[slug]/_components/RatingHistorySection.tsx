'use client';

import { useEffect, useState } from 'react';
import { RatingHistoryChart } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';

interface Series {
  weapon: string;
  category: string;
  points: Array<{ date: string; rating: number; rank: number | null }>;
}

interface Props {
  slug: string;
  apiUrl: string;
}

/**
 * Ranking-history chart for the public fighter profile. Fetches the per-weapon
 * rating time-series and lets the viewer switch weapons. Renders nothing until
 * there is at least one series with 2+ points (a single point can't draw a line).
 */
export function RatingHistorySection({ slug, apiUrl }: Props) {
  const { t } = useI18n();
  const [series, setSeries] = useState<Series[] | null>(null);
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(`${apiUrl}/api/v1/fighters/${slug}/rating-history`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : { series: [] }))
      .then((data: { series?: Series[] }) => {
        if (!cancelled) setSeries(data.series ?? []);
      })
      .catch(() => {
        if (!cancelled) setSeries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, apiUrl]);

  if (series === null) return null;
  const withData = series.filter((s) => s.points.length >= 2);
  if (withData.length === 0) return null;

  const active = withData[Math.min(selected, withData.length - 1)]!;
  const label = (s: Series) => (s.category ? `${s.weapon} · ${s.category}` : s.weapon);

  return (
    <section className="mb-6 rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-accent">
          {t('publicApp.fighterProfile.ratingHistory')}
        </h2>
        {withData.length > 1 && (
          <select
            aria-label={t('publicApp.fighterProfile.ratingHistoryWeapon')}
            value={selected}
            onChange={(event) => setSelected(Number(event.target.value))}
            className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
          >
            {withData.map((s, i) => (
              <option key={label(s)} value={i}>
                {label(s)}
              </option>
            ))}
          </select>
        )}
      </div>
      <RatingHistoryChart
        points={active.points}
        ariaLabel={t('publicApp.fighterProfile.ratingHistory')}
      />
    </section>
  );
}
