'use client';

import { AdminPageHeader, AiKeysManager } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { getPublicApiUrl } from '@/lib/api-url';

export default function AdminAIKeysPage() {
  const apiUrl = getPublicApiUrl();
  const { t } = useI18n();

  return (
    <main className="mx-auto max-w-5xl px-6 py-12 lg:px-8">
      <AdminPageHeader
        eyebrow={t('admin.aiSettings.eyebrow')}
        title={t('admin.aiSettings.keysTitle')}
        subtitle={t('admin.aiSettings.keysDescription')}
      />
      <AiKeysManager
        apiBase={`${apiUrl}/api/v1/admin/ai-keys`}
        modelsUrl={`${apiUrl}/api/v1/ai/models`}
        t={t}
        ns="admin.aiSettings"
        perKeyModelSync
      />
    </main>
  );
}
