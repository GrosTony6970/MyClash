'use client';

import { AdminPageHeader } from '@myclash/ui';
import { useI18n } from '../../../../src/i18n/I18nProvider';
import { RulesetsTopNav } from '../../../../src/components/rulesets/RulesetsTopNav';
import { LeagueScoringSystemsTable } from './_components/LeagueScoringSystemsTable';

export default function LeagueScoringSystemsListPage() {
  const { t } = useI18n();
  return (
    <main className="mx-auto w-full max-w-[110rem] px-6 py-12 lg:px-8">
      <AdminPageHeader
        eyebrow="Rulesets"
        title={t('admin.rulesets.league.title')}
        subtitle={t('admin.rulesets.league.subtitle')}
      />
      <RulesetsTopNav active="league" />
      <LeagueScoringSystemsTable />
    </main>
  );
}
