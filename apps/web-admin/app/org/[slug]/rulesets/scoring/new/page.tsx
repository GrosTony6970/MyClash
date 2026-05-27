'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { DEFAULT_FORMULA_CONSTANTS } from '@myclash/rulesets';
import { useI18n } from '../../../../../../src/i18n/I18nProvider';
import {
  RulesetForm,
  DEFAULT_MATCH_FORMAT_DEFAULTS,
} from '../../../../../../src/components/rulesets/RulesetForm';

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

/**
 * Organizer-side "create scoring ruleset" page. POSTs to the org-scoped
 * endpoint so the row is created with `owner_organization_id` set and is
 * immediately usable on the org's tournaments. From the list page the org
 * can later submit it for super-admin review to share platform-wide.
 */
export default function OrgNewScoringRulesetPage() {
  const params = useParams<{ slug: string }>();
  const slugForLink = params.slug ?? '';
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
      .then((r) => (r.ok ? r.json() : null))
      .then((org: { id?: string } | null) => {
        if (!cancelled && org?.id) setOrgId(org.id);
      });
    return () => {
      cancelled = true;
    };
  }, [params.slug]);

  return (
    <main className="max-w-4xl p-8">
      <div className="mb-2 text-sm">
        <Link
          href={`/org/${slugForLink}/rulesets/scoring`}
          className="text-slate-500 hover:underline"
        >
          {t('admin.rulesets.backToList')}
        </Link>
      </div>
      <h1 className="mb-1 text-2xl font-bold text-slate-900">{t('admin.rulesets.createTitle')}</h1>
      <p className="mb-6 text-sm text-slate-500">{t('admin.rulesets.createDescription')}</p>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <RulesetForm
        initial={{
          name: '',
          description: '',
          version: '1.0.0',
          scoreFormula: null,
          constants: { ...DEFAULT_FORMULA_CONSTANTS, pointsPerVictory: 3 },
          tiebreakers: [{ variable: 'victories', direction: 'desc' }],
          matchFormatDefaults: DEFAULT_MATCH_FORMAT_DEFAULTS,
          doublePenaltyFormula: '',
        }}
        busy={busy || !orgId}
        submitLabel={t('admin.rulesets.createButton')}
        onSubmit={async (data) => {
          if (!orgId) return;
          setBusy(true);
          setError(null);
          try {
            const res = await fetch(`${apiUrl}/api/v1/organizations/${orgId}/custom-rulesets`, {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(data),
            });
            if (!res.ok) {
              const body = (await res.json().catch(() => ({}))) as { message?: string };
              throw new Error(body.message ?? t('admin.rulesets.actionFailed'));
            }
            const created = (await res.json()) as { id: string };
            router.push(`/org/${slugForLink}/rulesets/scoring/${created.id}/edit`);
          } catch (err) {
            setError(err instanceof Error ? err.message : t('admin.rulesets.actionFailed'));
            setBusy(false);
          }
        }}
        onCancel={() => router.push(`/org/${slugForLink}/rulesets/scoring`)}
      />
    </main>
  );
}
