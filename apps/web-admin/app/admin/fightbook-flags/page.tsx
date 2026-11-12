'use client';

import { AdminPageHeader } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { SparFlagList } from '@/components/fightbook/SparFlagList';

const PLATFORM = { kind: 'platform' } as const;

/**
 * The platform's Safety reports: every fighter's report about a spar, club by club. A platform
 * super admin only; a lower tier reaches it by its address and reads why it is refused.
 */
export default function PlatformFightBookFlagsPage() {
  const { t } = useI18n();
  return (
    <main className="mx-auto max-w-[110rem] px-6 py-8 lg:px-8">
      <AdminPageHeader
        title={t('admin.fightBookFlags.title')}
        subtitle={t('admin.fightBookFlags.description')}
      />
      <SparFlagList scope={PLATFORM} />
    </main>
  );
}
