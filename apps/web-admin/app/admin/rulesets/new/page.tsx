'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { DEFAULT_FORMULA_CONSTANTS } from '@myclash/rulesets';
import { useI18n } from '../../../../src/i18n/I18nProvider';
import {
  RulesetForm,
  DEFAULT_MATCH_FORMAT_DEFAULTS,
} from '../../../../src/components/rulesets/RulesetForm';

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

export default function NewRulesetPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <main className="max-w-4xl p-8">
      <div className="mb-2 text-sm">
        <Link href="/admin/rulesets" className="text-slate-500 hover:underline">
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
        busy={busy}
        submitLabel={t('admin.rulesets.createButton')}
        onSubmit={async (data) => {
          setBusy(true);
          setError(null);
          try {
            const res = await fetch(`${apiUrl}/api/v1/admin/custom-rulesets`, {
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
            router.push(`/admin/rulesets/${created.id}/edit`);
          } catch (err) {
            setError(err instanceof Error ? err.message : t('admin.rulesets.actionFailed'));
            setBusy(false);
          }
        }}
        onCancel={() => router.push('/admin/rulesets')}
      />
    </main>
  );
}
