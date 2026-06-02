'use client';

import { useParams } from 'next/navigation';
import { AdminPageHeader } from '@myclash/ui';
import { useI18n } from '../../../../../src/i18n/I18nProvider';
import { RulesetsTopNav } from '../../../../../src/components/rulesets/RulesetsTopNav';
import { LeagueScoringSystemsTable } from '../../../../admin/rulesets/league/_components/LeagueScoringSystemsTable';

export default function OrgLeagueScoringSystemsPage() {
  const { t } = useI18n();
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  return (
    <main id="main-content" className="mx-auto w-full max-w-6xl px-6 py-12 lg:px-8">
      <AdminPageHeader
        eyebrow={t('organizer.shell.eyebrow')}
        title={t('admin.rulesets.league.title')}
        subtitle={t('admin.rulesets.league.orgSubtitle')}
      />
      <RulesetsTopNav active="league" basePath={`/org/${slug}/rulesets`} />
      <LeagueScoringSystemsTable readOnly />
    </main>
  );
}
