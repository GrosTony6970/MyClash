'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useI18n } from '../../../../../../src/i18n/I18nProvider';
import {
  DEFAULT_PENALTY_RULESET_FORM_VALUES,
  PenaltyRulesetForm,
  type AccumulationScope,
  type BlackCardForfeitScope,
  type PenaltyRulesetFormValue,
} from '../../../../../../src/components/rulesets/PenaltyRulesetForm';
import { PenaltyVersionHistory } from '../../../../../../src/components/rulesets/PenaltyVersionHistory';
import { getPublicApiUrl } from '@/lib/api-url';

const apiUrl = getPublicApiUrl();

interface PenaltyRulesetDetail {
  id: string;
  code: string;
  version: string;
  name: string;
  description: string | null;
  built_in: boolean;
  public_visibility: boolean;
  accumulation_scope: AccumulationScope;
  yellow_card_points?: number | null;
  red_card_points?: number | null;
  black_card_points?: number | null;
  first_black_card_forfeit?: BlackCardForfeitScope | null;
  second_black_card_forfeit?: BlackCardForfeitScope | null;
  penalty_ruleset_entries: Array<{
    id: string;
    group_number: number;
    ref_number: string;
    short_name: string;
    description: string;
    sanctions: Array<'yellow' | 'red' | 'black'>;
    sort_order: number;
  }>;
}

export default function EditPenaltyRulesetPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { t } = useI18n();
  const id = params.id;

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initial, setInitial] = useState<(PenaltyRulesetFormValue & { builtIn: boolean }) | null>(
    null,
  );

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    fetch(`${apiUrl}/api/v1/penalty-rulesets/${id}`, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error(t('admin.penaltyRulesets.loadError'));
        return (await res.json()) as PenaltyRulesetDetail;
      })
      .then((data) => {
        if (cancelled) return;
        const sorted = [...(data.penalty_ruleset_entries ?? [])].sort(
          (a, b) => a.sort_order - b.sort_order,
        );
        setInitial({
          name: data.name,
          description: data.description ?? '',
          code: data.code,
          version: data.version,
          accumulationScope: data.accumulation_scope,
          publicVisibility: data.public_visibility,
          entries: sorted.map((e) => ({
            groupNumber: e.group_number,
            refNumber: e.ref_number,
            shortName: e.short_name,
            description: e.description,
            sanctions: e.sanctions,
          })),
          yellowCardPoints:
            data.yellow_card_points ?? DEFAULT_PENALTY_RULESET_FORM_VALUES.yellowCardPoints,
          redCardPoints: data.red_card_points ?? DEFAULT_PENALTY_RULESET_FORM_VALUES.redCardPoints,
          blackCardPoints:
            data.black_card_points ?? DEFAULT_PENALTY_RULESET_FORM_VALUES.blackCardPoints,
          firstBlackCardForfeit:
            data.first_black_card_forfeit ??
            DEFAULT_PENALTY_RULESET_FORM_VALUES.firstBlackCardForfeit,
          secondBlackCardForfeit:
            data.second_black_card_forfeit ??
            DEFAULT_PENALTY_RULESET_FORM_VALUES.secondBlackCardForfeit,
          builtIn: data.built_in,
        });
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : t('admin.penaltyRulesets.loadError'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, t]);

  return (
    <main className="max-w-[110rem] p-8">
      <div className="mb-2 text-sm">
        <Link href="/admin/rulesets/penalty" className="text-muted hover:underline">
          {t('admin.rulesets.backToList')}
        </Link>
      </div>
      <h1 className="mb-1 font-display font-bold text-2xl sm:text-3xl text-foreground">
        {t('admin.penaltyRulesets.editTitle')}
      </h1>
      <p className="mb-6 text-sm text-muted">{t('admin.penaltyRulesets.editDescription')}</p>

      {error && (
        <div className="mb-4 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {loading || !initial ? (
        <p className="text-sm text-muted">{t('admin.rulesets.loading')}</p>
      ) : (
        <>
          {initial.builtIn && (
            <div className="mb-4 rounded-md border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
              {t('admin.penaltyRulesets.builtInSuperAdminBanner')}
            </div>
          )}
          <PenaltyRulesetForm
            initial={initial}
            codeLocked
            busy={busy}
            submitLabel={t('admin.rulesets.saveAction')}
            onSubmit={(data) => {
              void (async () => {
                setBusy(true);
                setError(null);
                try {
                  const res = await fetch(`${apiUrl}/api/v1/penalty-rulesets/${id}`, {
                    method: 'PATCH',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      name: data.name,
                      description: data.description,
                      accumulationScope: data.accumulationScope,
                      publicVisibility: data.publicVisibility,
                      entries: data.entries,
                      yellowCardPoints: data.yellowCardPoints,
                      redCardPoints: data.redCardPoints,
                      blackCardPoints: data.blackCardPoints,
                      firstBlackCardForfeit: data.firstBlackCardForfeit,
                      secondBlackCardForfeit: data.secondBlackCardForfeit,
                    }),
                  });
                  if (!res.ok) {
                    const body = (await res.json().catch(() => ({}))) as { message?: string };
                    throw new Error(body.message ?? t('admin.rulesets.actionFailed'));
                  }
                  router.push('/admin/rulesets/penalty');
                } catch (err) {
                  setError(err instanceof Error ? err.message : t('admin.rulesets.actionFailed'));
                  setBusy(false);
                }
              })();
            }}
            onCancel={() => router.push('/admin/rulesets/penalty')}
          />
          {!initial.builtIn && (
            <PenaltyVersionHistory rulesetId={id} currentVersion={initial.version} />
          )}
        </>
      )}
    </main>
  );
}
