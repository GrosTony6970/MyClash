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
  // The answer carries the slug it was asked for: after a switch to another club the old club's
  // id and refusal read as "no answer yet" until the new lookup lands, so nothing of A reaches B.
  const [lookup, setLookup] = useState<{
    slug: string;
    orgId: string | null;
    outcome: Outcome | null;
  } | null>(null);
  const answer = lookup?.slug === slug ? lookup : null;
  const orgId = answer?.orgId ?? null;
  const outcome = answer?.outcome ?? null;

  useEffect(() => {
    const controller = new AbortController();
    void apiRequest<{ id: string }>(
      getPublicApiUrl(),
      `/api/v1/organizations/slug/${encodeURIComponent(slug)}`,
      { signal: controller.signal },
    ).then((r) => {
      if (controller.signal.aborted) return;
      if (r.ok) setLookup({ slug, orgId: r.data.id, outcome: null });
      else {
        const text = failureMessage(r, t, t('admin.fightBookFlags.loadFailed')) ?? '';
        setLookup({ slug, orgId: null, outcome: errorOutcome(text) });
      }
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
      {scope && <SparFlagList key={scope.orgId} scope={scope} />}
    </main>
  );
}
