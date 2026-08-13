'use client';

import { useCallback, useEffect, useState } from 'react';
import { AdminPageHeader } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { AiBudgetView } from '@/components/ai/AiBudgetView';
import { type UsageRollup } from '@/components/ai/AiUsageView';
import { getPublicApiUrl } from '@/lib/api-url';

interface PlatformAIConfig {
  monthlyBudgetEur: number | null;
  updatedAt: string | null;
}

/** Start of the current month, UTC — see the Dashboard page for why. */
function monthStartIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export default function AdminAIBudgetPage() {
  const apiUrl = getPublicApiUrl();
  const { t } = useI18n();
  const [config, setConfig] = useState<PlatformAIConfig | null>(null);
  const [rollup, setRollup] = useState<UsageRollup | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshRollup = useCallback(async () => {
    const res = await fetch(
      `${apiUrl}/api/v1/admin/ai-usage/summary?from=${encodeURIComponent(monthStartIso())}`,
      { credentials: 'include' },
    );
    if (res.ok) setRollup((await res.json()) as UsageRollup);
  }, [apiUrl]);

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

  async function saveBudget(value: number | null) {
    const res = await fetch(`${apiUrl}/api/v1/admin/ai-settings/budget`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ monthlyBudgetEur: value }),
    });
    if (!res.ok) throw new Error(t('admin.aiSettings.budgetError'));
    setConfig((await res.json()) as PlatformAIConfig);
    await refreshRollup();
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-12 lg:px-8">
      <AdminPageHeader
        eyebrow={t('admin.aiSettings.eyebrow')}
        title={t('admin.aiSettings.budgetTitle')}
        subtitle={t('admin.aiSettings.budgetDescription')}
      />
      {error && (
        <div className="mb-6 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}
      <section className="rounded-xl border border-border bg-surface p-6">
        <AiBudgetView
          budgetEur={config?.monthlyBudgetEur ?? null}
          spentEur={rollup?.total.costEur ?? 0}
          onSave={saveBudget}
          t={t}
        />
      </section>
    </main>
  );
}
