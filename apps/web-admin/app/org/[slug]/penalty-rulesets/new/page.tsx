'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useI18n } from '../../../../../src/i18n/I18nProvider';
import {
  DEFAULT_PENALTY_RULESET_FORM_VALUES,
  PenaltyRulesetForm,
  type PenaltyRulesetFormValue,
} from '../../../../../src/components/rulesets/PenaltyRulesetForm';

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

export default function OrgNewPenaltyRulesetPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);

  useEffect(() => {
    if (!params.slug) return;
    let cancelled = false;
    fetch(`${apiUrl}/api/v1/organizations/slug/${encodeURIComponent(params.slug)}`, {
      credentials: 'include',
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(t('admin.penaltyRulesets.loadError'));
        return (await res.json()) as { id: string };
      })
      .then((org) => {
        if (!cancelled) setOrgId(org.id);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t('admin.penaltyRulesets.loadError'));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [params.slug, t]);

  const initial: PenaltyRulesetFormValue = {
    name: '',
    description: '',
    code: '',
    version: '1.0.0',
    accumulationScope: 'match',
    publicVisibility: false,
    entries: [],
    ...DEFAULT_PENALTY_RULESET_FORM_VALUES,
  };

  return (
    <main className="max-w-5xl p-8">
      <div className="mb-2 text-sm">
        <Link
          href={`/org/${params.slug}/penalty-rulesets`}
          className="text-slate-500 hover:underline"
        >
          {t('admin.rulesets.backToList')}
        </Link>
      </div>
      <h1 className="mb-1 text-2xl font-bold text-slate-900">
        {t('admin.penaltyRulesets.createTitle')}
      </h1>
      <p className="mb-6 text-sm text-slate-500">{t('admin.penaltyRulesets.createDescription')}</p>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <PenaltyRulesetForm
        initial={initial}
        busy={busy || !orgId}
        submitLabel={t('admin.penaltyRulesets.createButton')}
        onSubmit={async (data) => {
          if (!orgId) return;
          setBusy(true);
          setError(null);
          try {
            const res = await fetch(`${apiUrl}/api/v1/penalty-rulesets`, {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ownerOrganizationId: orgId,
                ...data,
              }),
            });
            if (!res.ok) {
              const body = (await res.json().catch(() => ({}))) as { message?: string };
              throw new Error(body.message ?? t('admin.rulesets.actionFailed'));
            }
            const created = (await res.json()) as { id: string };
            router.push(`/org/${params.slug}/penalty-rulesets/${created.id}/edit`);
          } catch (err) {
            setError(err instanceof Error ? err.message : t('admin.rulesets.actionFailed'));
            setBusy(false);
          }
        }}
        onCancel={() => router.push(`/org/${params.slug}/penalty-rulesets`)}
      />
    </main>
  );
}
