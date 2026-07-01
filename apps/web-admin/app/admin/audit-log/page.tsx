'use client';

import { SegmentedTabs } from '@myclash/ui';
import { useState } from 'react';
import { useI18n } from '../../../src/i18n/I18nProvider';
import { AuditLogPanel } from './AuditLogPanel';
import { PlatformLogPanel } from './PlatformLogPanel';

type LogTab = 'audit' | 'platform';

export default function AdminLogPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<LogTab>('audit');

  return (
    <main className="mx-auto max-w-7xl px-6 py-8 lg:px-8">
      <h1 className="font-display font-bold text-2xl sm:text-3xl mb-6">{t('admin.log.title')}</h1>
      <SegmentedTabs<LogTab>
        tabs={[
          { value: 'audit', label: t('admin.log.tabs.audit') },
          { value: 'platform', label: t('admin.log.tabs.platform') },
        ]}
        value={tab}
        onChange={setTab}
        aria-label={t('admin.log.title')}
        className="mb-6 max-w-md"
      />
      {tab === 'audit' && <AuditLogPanel />}
      {tab === 'platform' && <PlatformLogPanel />}
    </main>
  );
}
