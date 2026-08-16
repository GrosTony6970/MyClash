'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import { getPublicApiUrl } from '@/lib/api-url';
import { TrendChart, type TrendSample } from './TrendChart';

interface SeriesResponse {
  since: string;
  samples: TrendSample[];
}

const API = getPublicApiUrl();
const WINDOW_HOURS = 24;

function useSeries(): { series: SeriesResponse | null; failed: boolean } {
  const [series, setSeries] = useState<SeriesResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API}/api/v1/admin/system/runtime-health/series?hours=${WINDOW_HOURS}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('series');
        setSeries((await res.json()) as SeriesResponse);
      })
      .catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === 'AbortError')) setFailed(true);
      });
    return () => controller.abort();
  }, []);

  return { series, failed };
}

function Note({ children }: { children: ReactNode }) {
  return <div className="border-t border-border px-4 py-3 text-xs text-muted">{children}</div>;
}

export function RuntimeHealthTrend() {
  const { t } = useI18n();
  const { series, failed } = useSeries();

  if (failed) return <Note>{t('admin.systemVersions.runtimeHealth.trend.loadError')}</Note>;
  if (!series) return null;

  // Two points are the minimum that can show a direction. Below that the strip
  // would be an empty frame implying the feature is broken rather than young.
  if (series.samples.length < 2) {
    return <Note>{t('admin.systemVersions.runtimeHealth.trend.empty')}</Note>;
  }

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
      <TrendChart samples={series.samples} since={series.since} windowHours={WINDOW_HOURS} />
      <p className="mt-2 text-xs text-muted">
        {t('admin.systemVersions.runtimeHealth.trend.samples')}: {series.samples.length}
      </p>
    </div>
  );
}
