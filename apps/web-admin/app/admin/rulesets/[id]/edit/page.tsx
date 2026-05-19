'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { DEFAULT_FORMULA_CONSTANTS } from '@myclash/rulesets';
import type { FormulaConstants, FormulaNode, Tiebreaker } from '@myclash/rulesets';
import { useI18n } from '../../../../../src/i18n/I18nProvider';
import {
  RulesetForm,
  type RulesetFormValue,
} from '../../../../../src/components/rulesets/RulesetForm';

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

interface CustomRulesetDetail {
  id: string;
  code: string;
  version: string;
  name: string;
  description: string | null;
  status: 'draft' | 'published' | 'archived';
  score_formula: FormulaNode | Record<string, never>;
  constants: Partial<FormulaConstants> | null;
  tiebreakers: Tiebreaker[];
  is_default: boolean;
  is_system: boolean;
}

export default function EditRulesetPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { t } = useI18n();
  const id = params.id;

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initial, setInitial] = useState<(RulesetFormValue & { isSystem: boolean }) | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    fetch(`${apiUrl}/api/v1/admin/custom-rulesets/${id}`, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error(t('admin.rulesets.loadOneError'));
        return (await res.json()) as CustomRulesetDetail;
      })
      .then((data) => {
        if (cancelled) return;
        const formula =
          data.score_formula && 'type' in (data.score_formula as object)
            ? (data.score_formula as FormulaNode)
            : null;
        setInitial({
          name: data.name,
          description: data.description ?? '',
          version: data.version,
          scoreFormula: formula,
          constants: { ...DEFAULT_FORMULA_CONSTANTS, ...(data.constants ?? {}) },
          tiebreakers: data.tiebreakers ?? [],
          isSystem: data.is_system,
        });
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : t('admin.rulesets.loadOneError'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, t]);

  return (
    <main className="max-w-4xl p-8">
      <div className="mb-2 text-sm">
        <Link href="/admin/rulesets" className="text-slate-500 hover:underline">
          {t('admin.rulesets.backToList')}
        </Link>
      </div>
      <h1 className="mb-1 text-2xl font-bold text-[#0f172a]">{t('admin.rulesets.editTitle')}</h1>
      <p className="mb-6 text-sm text-slate-500">{t('admin.rulesets.editDescription')}</p>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading || !initial ? (
        <p className="text-sm text-slate-400">{t('admin.rulesets.loading')}</p>
      ) : (
        <>
          {initial.isSystem && (
            <div className="mb-4 rounded-md border border-purple-200 bg-purple-50 px-4 py-3 text-sm text-purple-800">
              {t('admin.rulesets.systemReadOnlyBanner')}
            </div>
          )}
          <RulesetForm
            initial={initial}
            disabled={initial.isSystem}
            busy={busy}
            submitLabel={t('admin.rulesets.saveAction')}
            onSubmit={async (data) => {
              setBusy(true);
              setError(null);
              try {
                const res = await fetch(`${apiUrl}/api/v1/admin/custom-rulesets/${id}`, {
                  method: 'PATCH',
                  credentials: 'include',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(data),
                });
                if (!res.ok) {
                  const body = (await res.json().catch(() => ({}))) as { message?: string };
                  throw new Error(body.message ?? t('admin.rulesets.actionFailed'));
                }
                router.push('/admin/rulesets');
              } catch (err) {
                setError(err instanceof Error ? err.message : t('admin.rulesets.actionFailed'));
                setBusy(false);
              }
            }}
            onCancel={() => router.push('/admin/rulesets')}
          />
        </>
      )}
    </main>
  );
}
