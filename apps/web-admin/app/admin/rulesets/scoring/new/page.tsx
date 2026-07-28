'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { DEFAULT_FORMULA_CONSTANTS, DEFAULT_TARGETS } from '@myclash/rulesets';
import { useI18n } from '../../../../../src/i18n/I18nProvider';
import {
  RulesetForm,
  DEFAULT_MATCH_FORMAT_DEFAULTS,
} from '../../../../../src/components/rulesets/RulesetForm';
import { DEFAULT_AFTERBLOW_GRAMMAR } from '../../../../../src/components/rulesets/AfterblowGrammarEditor';
import { getPublicApiUrl } from '@/lib/api-url';

const apiUrl = getPublicApiUrl();

export default function NewRulesetPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <main className="max-w-4xl p-8">
      <div className="mb-2 text-sm">
        <Link href="/admin/rulesets/scoring" className="text-muted hover:underline">
          {t('admin.rulesets.backToList')}
        </Link>
      </div>
      <h1 className="mb-1 font-display font-bold text-2xl sm:text-3xl text-foreground">
        {t('admin.rulesets.createTitle')}
      </h1>
      <p className="mb-6 text-sm text-muted">{t('admin.rulesets.createDescription')}</p>

      {error && (
        <div className="mb-4 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      <RulesetForm
        validateUrl={`${apiUrl}/api/v1/admin/custom-rulesets/validate`}
        initial={{
          name: '',
          description: '',
          version: '1.0.0',
          scoreFormula: null,
          constants: { ...DEFAULT_FORMULA_CONSTANTS, pointsPerVictory: 3 },
          tiebreakers: [{ variable: 'victories', direction: 'desc' }],
          matchFormatDefaults: DEFAULT_MATCH_FORMAT_DEFAULTS,
          doublePenaltyFormula: null,
          targets: [...DEFAULT_TARGETS],
          afterblow: DEFAULT_AFTERBLOW_GRAMMAR,
        }}
        busy={busy}
        submitLabel={t('admin.rulesets.createButton')}
        onSubmit={(data) => {
          void (async () => {
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
              router.push(`/admin/rulesets/scoring/${created.id}/edit`);
            } catch (err) {
              setError(err instanceof Error ? err.message : t('admin.rulesets.actionFailed'));
              setBusy(false);
            }
          })();
        }}
        onCancel={() => router.push('/admin/rulesets/scoring')}
      />
    </main>
  );
}
