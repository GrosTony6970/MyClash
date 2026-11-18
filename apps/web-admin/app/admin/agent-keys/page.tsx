'use client';

import { AdminPageHeader } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { AgentKeysPanel } from './AgentKeysPanel';

/**
 * The ops agent's key (docs/superpowers/specs/2026-11-18-ops-agent-design.md, operator guide G8):
 * see it and revoke it. The deploy creates keys; this screen never does.
 */
export default function AdminAgentKeysPage() {
  const { t } = useI18n();
  return (
    <main className="mx-auto w-full max-w-[110rem] space-y-6 px-6 py-12 lg:px-8">
      <AdminPageHeader
        eyebrow={t('admin.dashboard.eyebrow')}
        title={t('admin.agentKeys.title')}
        subtitle={t('admin.agentKeys.description')}
      />
      <AgentKeysPanel />
    </main>
  );
}
