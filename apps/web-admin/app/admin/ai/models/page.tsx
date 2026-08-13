'use client';

import { useEffect, useState } from 'react';
import { AdminPageHeader, Button, type AiKeyModelOption, type AiKeyProvider } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { getPublicApiUrl } from '@/lib/api-url';

type ModelsMap = Record<AiKeyProvider, AiKeyModelOption[]>;

interface ModelSyncReport {
  provider: string;
  registered: string[];
  live: string[];
  newAtProvider: string[];
  missingAtProvider: string[];
}

const PROVIDER_LABELS: Record<AiKeyProvider, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  mistral: 'Mistral',
  google: 'Google',
};

const EMPTY_MODELS: ModelsMap = { anthropic: [], openai: [], mistral: [], google: [] };

export default function AdminAIModelsPage() {
  const apiUrl = getPublicApiUrl();
  const { t } = useI18n();
  const [models, setModels] = useState<ModelsMap>(EMPTY_MODELS);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncReport, setSyncReport] = useState<ModelSyncReport | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/ai/models`, { credentials: 'include', signal: controller.signal })
      .then((res) => (res.ok ? (res.json() as Promise<ModelsMap>) : null))
      .then((data) => {
        if (data) setModels(data);
      })
      .catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          setError(t('admin.aiSettings.loadError'));
        }
      });
    return () => controller.abort();
  }, [apiUrl, t]);

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

  const providers = (Object.keys(PROVIDER_LABELS) as AiKeyProvider[]).filter(
    (p) => (models[p] ?? []).length > 0,
  );

  return (
    <main className="mx-auto max-w-4xl px-6 py-12 lg:px-8">
      <AdminPageHeader
        eyebrow={t('admin.aiSettings.eyebrow')}
        title={t('admin.aiSettings.modelsTitle')}
        subtitle={t('admin.aiSettings.modelsDescription')}
      />

      {error && (
        <div className="mb-6 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="space-y-6">
        {/* Curated catalog per provider — labels + capability flags, no pricing. */}
        {providers.length === 0 ? (
          <p className="rounded-md border border-border bg-surface px-4 py-6 text-center text-sm text-muted">
            {t('admin.aiSettings.catalog.empty')}
          </p>
        ) : (
          providers.map((provider) => (
            <section key={provider} className="rounded-xl border border-border bg-surface p-6">
              <h2 className="mb-4 font-display text-lg font-semibold text-foreground">
                {PROVIDER_LABELS[provider]}
              </h2>
              <ul className="divide-y divide-border">
                {models[provider].map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center gap-2 py-2">
                    <span className="font-medium text-foreground">{m.label}</span>
                    <code className="text-xs text-muted">{m.id}</code>
                    {m.isDefault && (
                      <span className="inline-flex items-center rounded-md border border-accent/30 bg-accent/10 px-2 py-0.5 text-xs font-semibold text-accent">
                        {t('admin.aiSettings.catalog.default')}
                      </span>
                    )}
                    {m.recommendedForToolUse && (
                      <span className="inline-flex items-center rounded-md border border-success/30 bg-success/10 px-2 py-0.5 text-xs font-semibold text-success">
                        {t('admin.aiSettings.catalog.recommended')}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}

        {/* Model-sync — diff the curated registry against the active key's live models. */}
        <section className="rounded-xl border border-border bg-surface p-6">
          <h2 className="font-display text-lg font-semibold text-foreground">
            {t('admin.aiSettings.modelSync.title')}
          </h2>
          <p className="mb-4 mt-1 text-xs text-muted">{t('admin.aiSettings.modelSync.hint')}</p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={syncing}
            onClick={() => void runModelSync()}
          >
            {syncing
              ? t('admin.aiSettings.modelSync.checking')
              : t('admin.aiSettings.modelSync.check')}
          </Button>
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
