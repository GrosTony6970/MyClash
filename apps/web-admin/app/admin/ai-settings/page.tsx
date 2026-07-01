'use client';

import { t } from '@myclash/i18n';
import { AiKeysManager } from '@myclash/ui';
import { useCallback, useEffect, useState } from 'react';
import { AiUsageView, type UsageRollup } from '../../../src/components/ai/AiUsageView';
import { AiBudgetView } from '../../../src/components/ai/AiBudgetView';

type AIProvider = 'anthropic' | 'openai' | 'mistral' | 'google';

interface ModelSyncReport {
  provider: AIProvider;
  registered: string[];
  live: string[];
  newAtProvider: string[];
  missingAtProvider: string[];
}

interface PlatformAIConfig {
  monthlyBudgetEur: number | null;
  updatedAt: string | null;
}

export default function AdminAISettingsPage() {
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
  const [config, setConfig] = useState<PlatformAIConfig | null>(null);
  const [rollup, setRollup] = useState<UsageRollup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncReport, setSyncReport] = useState<ModelSyncReport | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const refreshRollup = useCallback(async () => {
    const res = await fetch(`${apiUrl}/api/v1/admin/ai-usage/summary`, { credentials: 'include' });
    if (res.ok) setRollup((await res.json()) as UsageRollup);
  }, [apiUrl]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/admin/ai-settings`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (res.status === 401 || res.status === 403) {
          throw new Error(t('admin.aiSettings.accessDenied'));
        }
        if (!res.ok) throw new Error(t('admin.aiSettings.loadError'));
        setConfig((await res.json()) as PlatformAIConfig);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          setError(err instanceof Error ? err.message : t('admin.aiSettings.loadError'));
        }
      });
    fetch(`${apiUrl}/api/v1/admin/ai-usage/summary`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then((res) => (res.ok ? (res.json() as Promise<UsageRollup>) : null))
      .then((usage) => {
        if (usage) setRollup(usage);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [apiUrl]);

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

  async function runModelSync() {
    setSyncing(true);
    setSyncError(null);
    setSyncReport(null);
    try {
      // No body → diff the active platform key's provider against its live models.
      const res = await fetch(`${apiUrl}/api/v1/admin/ai-settings/model-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(t('admin.aiSettings.modelSync.error'));
      setSyncReport((await res.json()) as ModelSyncReport);
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : t('admin.aiSettings.modelSync.error'));
    } finally {
      setSyncing(false);
    }
  }

  return (
    <main className="p-8 max-w-3xl">
      <div className="mb-6">
        <h1 className="font-display font-bold text-2xl sm:text-3xl">
          {t('admin.aiSettings.title')}
        </h1>
        <p className="text-muted text-sm mt-1">{t('admin.aiSettings.description')}</p>
      </div>

      {error && (
        <div className="bg-danger/10 border border-danger/30 text-danger rounded-md px-4 py-3 mb-4 text-sm">
          {error}
        </div>
      )}

      <div className="space-y-6">
        <AiKeysManager
          apiBase={`${apiUrl}/api/v1/admin/ai-keys`}
          modelsUrl={`${apiUrl}/api/v1/ai/models`}
          t={t}
          ns="admin.aiSettings"
          onChanged={() => void refreshRollup()}
        />

        <section className="border border-border rounded-lg p-5">
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

        <section className="border border-border rounded-lg p-5">
          <h2 className="mb-4 font-display text-lg font-semibold text-foreground">
            {t('admin.aiSettings.usageTitle')}
          </h2>
          <AiUsageView rollup={rollup} t={t} />
        </section>

        <section className="border border-border rounded-lg p-5">
          <h3 className="text-sm font-semibold text-foreground">
            {t('admin.aiSettings.modelSync.title')}
          </h3>
          <p className="mt-1 mb-3 text-xs text-muted">{t('admin.aiSettings.modelSync.hint')}</p>
          <button
            type="button"
            onClick={() => {
              void runModelSync();
            }}
            disabled={syncing}
            className="border border-border hover:bg-background disabled:opacity-50 py-2 px-4 rounded-md text-sm"
          >
            {syncing
              ? t('admin.aiSettings.modelSync.checking')
              : t('admin.aiSettings.modelSync.check')}
          </button>
          {syncError && <p className="mt-3 text-sm text-danger">{syncError}</p>}
          {syncReport && (
            <div className="mt-4 space-y-3 text-sm">
              {syncReport.missingAtProvider.length > 0 && (
                <div>
                  <p className="font-medium text-danger">
                    {t('admin.aiSettings.modelSync.retiredHeading')}
                  </p>
                  <ul className="mt-1 list-disc pl-5 text-foreground-secondary">
                    {syncReport.missingAtProvider.map((id) => (
                      <li key={id}>{id}</li>
                    ))}
                  </ul>
                </div>
              )}
              {syncReport.newAtProvider.length > 0 && (
                <div>
                  <p className="font-medium text-foreground">
                    {t('admin.aiSettings.modelSync.newHeading')}
                  </p>
                  <ul className="mt-1 list-disc pl-5 text-foreground-secondary">
                    {syncReport.newAtProvider.map((id) => (
                      <li key={id}>{id}</li>
                    ))}
                  </ul>
                </div>
              )}
              {syncReport.missingAtProvider.length === 0 &&
                syncReport.newAtProvider.length === 0 && (
                  <p className="text-success">{t('admin.aiSettings.modelSync.upToDate')}</p>
                )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
