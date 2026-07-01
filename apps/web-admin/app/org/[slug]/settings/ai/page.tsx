'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { AiKeysManager } from '@myclash/ui';
import { useI18n } from '../../../../../src/i18n/I18nProvider';
import { AiUsageView, type UsageRollup } from '../../../../../src/components/ai/AiUsageView';
import { AiBudgetView } from '../../../../../src/components/ai/AiBudgetView';

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
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
  const { t } = useI18n();

  const [orgId, setOrgId] = useState<string | null>(null);
  const [config, setConfig] = useState<OrgAIConfig | null>(null);
  const [rollup, setRollup] = useState<UsageRollup | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshRollup = useCallback(async () => {
    if (!orgId) return;
    const res = await fetch(`${apiUrl}/api/v1/organizations/${orgId}/ai-usage/summary`, {
      credentials: 'include',
    });
    if (res.ok) setRollup((await res.json()) as UsageRollup);
  }, [apiUrl, orgId]);

  const refreshConfig = useCallback(async () => {
    if (!orgId) return;
    const res = await fetch(`${apiUrl}/api/v1/organizations/${orgId}/ai-settings`, {
      credentials: 'include',
    });
    if (res.ok) setConfig((await res.json()) as OrgAIConfig | null);
  }, [apiUrl, orgId]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/organizations/slug/${encodeURIComponent(slug)}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) return;
        const org = (await res.json()) as { id: string };
        setOrgId(org.id);
        const [cfgRes, usageRes] = await Promise.all([
          fetch(`${apiUrl}/api/v1/organizations/${org.id}/ai-settings`, {
            credentials: 'include',
            signal: controller.signal,
          }),
          fetch(`${apiUrl}/api/v1/organizations/${org.id}/ai-usage/summary`, {
            credentials: 'include',
            signal: controller.signal,
          }),
        ]);
        if (cfgRes.ok) setConfig((await cfgRes.json()) as OrgAIConfig | null);
        if (usageRes.ok) setRollup((await usageRes.json()) as UsageRollup);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        setError(t('admin.common.loadAiSettingsFailed'));
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [slug, apiUrl, t]);

  async function saveFlags(patch: {
    aiFeaturesDisabled?: boolean;
    organizerChatDisabled?: boolean;
  }) {
    if (!orgId) return;
    const res = await fetch(`${apiUrl}/api/v1/organizations/${orgId}/ai-settings/flags`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (res.ok) setConfig((await res.json()) as OrgAIConfig | null);
  }

  async function saveBudget(value: number | null) {
    if (!orgId) throw new Error(t('admin.aiSettings.budgetError'));
    const res = await fetch(`${apiUrl}/api/v1/organizations/${orgId}/ai-settings/budget`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ monthlyBudgetEur: value }),
    });
    if (!res.ok) throw new Error(t('admin.aiSettings.budgetError'));
    setConfig((await res.json()) as OrgAIConfig | null);
    await refreshRollup();
  }

  if (loading) {
    return (
      <main className="p-8 max-w-2xl">
        <div className="flex items-center gap-2 text-muted text-sm">
          <span className="w-4 h-4 border-2 border-muted border-t-transparent rounded-full animate-spin" />
          {t('common.loading')}
        </div>
      </main>
    );
  }

  return (
    <main className="p-8 max-w-3xl">
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
