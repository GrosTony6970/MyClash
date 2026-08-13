'use client';

import { AiKeysManager } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';

/**
 * Personal BYOK AI keys — power the fighter's own performance insight. Keys are
 * encrypted server-side; only the last 4 chars are ever read back. The fighter
 * can register several keys and pick which one is active; each has its own
 * monthly budget + month-to-date spend.
 */
export function AISettingsSection({ apiUrl }: { apiUrl: string }) {
  const { t } = useI18n();
  return (
    <div className="space-y-3">
      <div>
        <h2 className="font-display text-lg font-semibold text-foreground">
          {t('publicApp.meSettings.ai.title')}
        </h2>
        <p className="mt-1 text-sm leading-6 text-muted">{t('publicApp.meSettings.ai.subtitle')}</p>
      </div>
      <AiKeysManager
        apiBase={`${apiUrl}/api/v1/me/ai-keys`}
        modelsUrl={`${apiUrl}/api/v1/ai/models`}
        t={t}
        ns="publicApp.meSettings.ai"
      />
    </div>
  );
}
