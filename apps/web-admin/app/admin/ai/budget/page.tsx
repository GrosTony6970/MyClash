'use client';

import { useCallback, useEffect, useState } from 'react';
import { AdminPageHeader } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { apiRequest, failureMessage } from '@myclash/api-client';
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
    // Silent on a refusal, as before: it runs after a save the operator already
    // got an answer for, and the panel keeps its last good numbers.
    const r = await apiRequest<UsageRollup>(
      apiUrl,
      `/api/v1/admin/ai-usage/summary?from=${encodeURIComponent(monthStartIso())}`,
    );
    if (r.ok) setRollup(r.data);
  }, [apiUrl]);

  useEffect(() => {
    const controller = new AbortController();
    const from = monthStartIso();
    void Promise.all([
      apiRequest<PlatformAIConfig>(apiUrl, '/api/v1/admin/ai-settings', {
        signal: controller.signal,
      }),
      apiRequest<UsageRollup>(
        apiUrl,
        `/api/v1/admin/ai-usage/summary?from=${encodeURIComponent(from)}`,
        { signal: controller.signal },
      ),
    ]).then(([cfg, usage]) => {
      if (cfg.ok) setConfig(cfg.data);
      if (usage.ok) setRollup(usage.data);
      // Both reads used to swallow a REFUSAL into `null` and only the dropped
      // connection reached the catch — so a 403 on this console left it showing
      // zeroes with nothing to explain them.
      const failed = [cfg, usage].find((r) => !r.ok);
      if (failed && !failed.ok) {
        const message = failureMessage(failed, t, t('admin.aiSettings.loadError'));
        if (message) setError(message);
      }
    });
    return () => controller.abort();
  }, [apiUrl, t]);

  async function saveBudget(value: number | null) {
    const r = await apiRequest<PlatformAIConfig>(apiUrl, '/api/v1/admin/ai-settings/budget', {
      method: 'PATCH',
      body: { monthlyBudgetEur: value },
    });
    if (!r.ok) {
      // Keeps throwing: `AiBudgetView` renders `e.message` in its own error
      // line, and swallowing here would leave the field claiming it saved. It
      // passes no signal, so the abort `failureMessage` answers null for cannot
      // arrive; the fallback is what a future signal would land on.
      const reason = t('admin.aiSettings.budgetError');
      throw new Error(failureMessage(r, t, reason) ?? reason);
    }
    setConfig(r.data);
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
