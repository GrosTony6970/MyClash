'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { AdminPageHeader } from '@myclash/ui';
import { apiRequest, failureMessage } from '@myclash/api-client';
import { useI18n } from '@myclash/next-i18n/client';
import { getPublicApiUrl } from '@/lib/api-url';
import { SparFlagList } from '@/components/fightbook/SparFlagList';
import { errorOutcome, PageAlert, type Outcome } from '@/components/PageAlert';

/**
 * The club's Safety reports: what fighters reported about spars at this club's Events. The club's
 * admins only; the list's own read answers 403 to any other member.
 */
export default function ClubFightBookFlagsPage() {
  const { slug } = useParams<{ slug: string }>();
  const { t } = useI18n();
  const [orgId, setOrgId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void apiRequest<{ id: string }>(
      getPublicApiUrl(),
      `/api/v1/organizations/slug/${encodeURIComponent(slug)}`,
      { signal: controller.signal },
    ).then((r) => {
      if (controller.signal.aborted) return;
      if (r.ok) setOrgId(r.data.id);
      else
        setOutcome(errorOutcome(failureMessage(r, t, t('admin.fightBookFlags.loadFailed')) ?? ''));
    });
    return () => controller.abort();
  }, [slug, t]);

  const scope = useMemo(() => (orgId ? ({ kind: 'club', orgId } as const) : null), [orgId]);

  return (
    <main className="mx-auto max-w-[110rem] px-6 py-8 lg:px-8">
      <AdminPageHeader
        title={t('admin.fightBookFlags.title')}
        subtitle={t('admin.fightBookFlags.description')}
      />
      <PageAlert outcome={outcome} className="mb-6" />
      {scope && <SparFlagList scope={scope} />}
    </main>
  );
}
