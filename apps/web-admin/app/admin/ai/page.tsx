'use client';

import { useEffect, useState } from 'react';
import { AdminPageHeader, MetricCard, StatsGrid } from '@myclash/ui';
import { useI18n } from '@/i18n/I18nProvider';
import { AiUsageView, type UsageRollup } from '@/components/ai/AiUsageView';
import { getPublicApiUrl } from '@/lib/api-url';

interface PlatformAIConfig {
  monthlyBudgetEur: number | null;
  updatedAt: string | null;
}

/**
 * Start of the current month, UTC — matches the backend's `currentMonthStartIso`
 * so "this month" spend is metered against the monthly budget ceiling. Without
 * this the usage rollup returns ALL-TIME totals, which would over-report
 * utilization against a monthly cap.
 */
function monthStartIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function eur(n: number): string {
  return `€${n.toFixed(2)}`;
}

export default function AdminAIDashboardPage() {
  const apiUrl = getPublicApiUrl();
  const { t } = useI18n();
  const [config, setConfig] = useState<PlatformAIConfig | null>(null);
  const [rollup, setRollup] = useState<UsageRollup | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const from = monthStartIso();
    Promise.all([
      fetch(`${apiUrl}/api/v1/admin/ai-settings`, {
        credentials: 'include',
        signal: controller.signal,
      }).then((res) => (res.ok ? (res.json() as Promise<PlatformAIConfig>) : null)),
      fetch(`${apiUrl}/api/v1/admin/ai-usage/summary?from=${encodeURIComponent(from)}`, {
        credentials: 'include',
        signal: controller.signal,
      }).then((res) => (res.ok ? (res.json() as Promise<UsageRollup>) : null)),
    ])
      .then(([cfg, usage]) => {
        if (cfg) setConfig(cfg);
        if (usage) setRollup(usage);
      })
      .catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          setError(t('admin.aiSettings.loadError'));
        }
      });
    return () => controller.abort();
  }, [apiUrl, t]);

  const spent = rollup?.total.costEur ?? 0;
  const ceiling = config?.monthlyBudgetEur ?? null;
  const utilization = ceiling && ceiling > 0 ? Math.round((spent / ceiling) * 100) : null;

  return (
    <main className="mx-auto max-w-5xl px-6 py-12 lg:px-8">
      <AdminPageHeader
        eyebrow={t('admin.aiSettings.eyebrow')}
        title={t('admin.aiSettings.dashboardTitle')}
        subtitle={t('admin.aiSettings.dashboardDescription')}
      />

      {error && (
        <div className="mb-6 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      <StatsGrid cols={3} className="mb-10">
        <MetricCard
          label={t('admin.aiSettings.spendMtd')}
          value={eur(spent)}
          detail={t('admin.aiSettings.spendMtdDetail')}
        />
        <MetricCard
          label={t('admin.aiSettings.budgetCeiling')}
          value={ceiling == null ? t('admin.aiSettings.keys.unlimited') : eur(ceiling)}
        />
        <MetricCard
          label={t('admin.aiSettings.utilization')}
          value={utilization == null ? '—' : `${utilization}%`}
        />
      </StatsGrid>

      <section className="rounded-xl border border-border bg-surface p-6">
        <h2 className="mb-4 font-display text-lg font-semibold text-foreground">
          {t('admin.aiSettings.usageTitle')}
        </h2>
        <AiUsageView rollup={rollup} t={t} />
      </section>
    </main>
  );
}
