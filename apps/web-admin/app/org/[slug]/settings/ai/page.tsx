'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { AiKeysManager } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { apiRequest, failureMessage } from '@myclash/api-client';
import { AiUsageView, type UsageRollup } from '../../../../../src/components/ai/AiUsageView';
import { AiBudgetView } from '../../../../../src/components/ai/AiBudgetView';
import { getPublicApiUrl } from '@/lib/api-url';

interface OrgAIConfig {
  hasKey: boolean;
  monthlyBudgetEur: number | null;
  aiFeaturesDisabled: boolean;
  organizerChatDisabled: boolean;
  updatedAt: string | null;
}

export default function OrgAISettingsPage() {
  const params = useParams<{ slug: string }>();
  const { slug } = params;
  const apiUrl = getPublicApiUrl();
  const { t } = useI18n();

  const [orgId, setOrgId] = useState<string | null>(null);
  const [config, setConfig] = useState<OrgAIConfig | null>(null);
  const [rollup, setRollup] = useState<UsageRollup | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Both refreshers stay silent on a refusal, as before: they run after a
  // change the operator already saw land, and the panel they fill keeps its
  // last good numbers rather than blanking.
  const refreshRollup = useCallback(async () => {
    if (!orgId) return;
    const r = await apiRequest<UsageRollup>(
      apiUrl,
      `/api/v1/organizations/${orgId}/ai-usage/summary`,
    );
    if (r.ok) setRollup(r.data);
  }, [apiUrl, orgId]);

  const refreshConfig = useCallback(async () => {
    if (!orgId) return;
    const r = await apiRequest<OrgAIConfig | null>(
      apiUrl,
      `/api/v1/organizations/${orgId}/ai-settings`,
    );
    if (r.ok) setConfig(r.data);
  }, [apiUrl, orgId]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const org = await apiRequest<{ id: string }>(
        apiUrl,
        `/api/v1/organizations/slug/${encodeURIComponent(slug)}`,
        { signal: controller.signal },
      );
      if (!org.ok) {
        // No message is the unmount. Everything below is gated on the org id,
        // so a refusal here left the page blank and silent until now.
        const message = failureMessage(org, t, t('admin.common.loadAiSettingsFailed'));
        if (message) setError(message);
        setLoading(false);
        return;
      }
      setOrgId(org.data.id);
      const base = `/api/v1/organizations/${org.data.id}`;
      const [cfg, usage] = await Promise.all([
        apiRequest<OrgAIConfig | null>(apiUrl, `${base}/ai-settings`, {
          signal: controller.signal,
        }),
        apiRequest<UsageRollup>(apiUrl, `${base}/ai-usage/summary`, { signal: controller.signal }),
      ]);
      if (cfg.ok) setConfig(cfg.data);
      if (usage.ok) setRollup(usage.data);
      setLoading(false);
    })();
    return () => controller.abort();
  }, [slug, apiUrl, t]);

  async function saveFlags(patch: {
    aiFeaturesDisabled?: boolean;
    organizerChatDisabled?: boolean;
  }) {
    if (!orgId) return;
    setError(null);
    const r = await apiRequest<OrgAIConfig | null>(
      apiUrl,
      `/api/v1/organizations/${orgId}/ai-settings/flags`,
      { method: 'PATCH', body: patch },
    );
    if (!r.ok) {
      // A refused toggle used to snap back with no word at all, which reads as
      // a checkbox that does not work rather than a refusal.
      const message = failureMessage(r, t, t('admin.aiSettings.org.flagsError'));
      if (message) setError(message);
      return;
    }
    setConfig(r.data);
  }

  async function saveBudget(value: number | null) {
    if (!orgId) throw new Error(t('admin.aiSettings.budgetError'));
    const r = await apiRequest<OrgAIConfig | null>(
      apiUrl,
      `/api/v1/organizations/${orgId}/ai-settings/budget`,
      { method: 'PATCH', body: { monthlyBudgetEur: value } },
    );
    if (!r.ok) {
      // Keeps throwing: `AiBudgetView` renders `e.message` in its own error
      // line, and swallowing here would leave the field claiming it saved. It
      // passes no signal, so the abort `failureMessage` answers null for cannot
      // arrive; the fallback is what a future signal would land on.
      throw new Error(
        failureMessage(r, t, t('admin.aiSettings.budgetError')) ??
          t('admin.aiSettings.budgetError'),
      );
    }
    setConfig(r.data);
    await refreshRollup();
  }

  if (loading) {
    return (
      <main className="mx-auto w-full max-w-5xl p-8">
        <div className="flex items-center gap-2 text-muted text-sm">
          <span className="w-4 h-4 border-2 border-muted border-t-transparent rounded-full animate-spin" />
          {t('common.loading')}
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-5xl p-8">
      <div className="flex items-center gap-2 text-sm text-muted mb-1">
        <Link href={`/org/${slug}`} className="hover:text-foreground-secondary">
          {slug}
        </Link>
        <span>/</span>
        <span className="text-foreground font-medium">{t('admin.aiSettings.org.breadcrumb')}</span>
      </div>

      <h1 className="font-display font-bold text-2xl sm:text-3xl mb-1 mt-4">
        {t('admin.aiSettings.title')}
      </h1>
      <p className="text-muted text-sm mb-6">{t('admin.aiSettings.org.description')}</p>

      {error && (
        <div className="bg-danger/10 border border-danger/30 text-danger rounded-lg px-4 py-3 mb-6 text-sm">
          {error}
        </div>
      )}

      <div className="space-y-6">
        {orgId && (
          <AiKeysManager
            apiBase={`${apiUrl}/api/v1/organizations/${orgId}/ai-keys`}
            modelsUrl={`${apiUrl}/api/v1/ai/models`}
            t={t}
            ns="admin.aiSettings"
            onChanged={() => {
              void refreshConfig();
              void refreshRollup();
            }}
          />
        )}

        <section className="space-y-3 rounded-xl border border-border bg-surface p-6">
          <p className="text-sm font-medium text-foreground-secondary">
            {t('admin.aiSettings.org.availability')}
          </p>
          <label className="flex items-center gap-3 text-sm text-foreground">
            <input
              type="checkbox"
              className="accent-accent"
              checked={!config?.aiFeaturesDisabled}
              onChange={(e) => void saveFlags({ aiFeaturesDisabled: !e.target.checked })}
            />
            {t('admin.aiSettings.org.enableAi')}
          </label>
          <label className="flex items-center gap-3 text-sm text-foreground">
            <input
              type="checkbox"
              className="accent-accent"
              checked={!config?.organizerChatDisabled}
              disabled={config?.aiFeaturesDisabled}
              onChange={(e) => void saveFlags({ organizerChatDisabled: !e.target.checked })}
            />
            {t('admin.aiSettings.org.enableChat')}
          </label>
          <p className="text-xs text-muted">{t('admin.aiSettings.org.availabilityHint')}</p>
        </section>

        <section className="rounded-xl border border-border bg-surface p-6">
          <h2 className="mb-4 font-display text-lg font-semibold text-foreground">
            {t('admin.aiSettings.budgetTitle')}
          </h2>
          <AiBudgetView
            budgetEur={config?.monthlyBudgetEur ?? null}
            spentEur={rollup?.total.costEur ?? 0}
            onSave={saveBudget}
            t={t}
          />
        </section>

        <section className="rounded-xl border border-border bg-surface p-6">
          <h2 className="mb-4 font-display text-lg font-semibold text-foreground">
            {t('admin.aiSettings.usageTitle')}
          </h2>
          <AiUsageView rollup={rollup} t={t} />
        </section>
      </div>
    </main>
  );
}
