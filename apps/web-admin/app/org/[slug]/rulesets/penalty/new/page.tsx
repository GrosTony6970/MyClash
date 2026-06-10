'use client';

import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useI18n } from '../../../../../../src/i18n/I18nProvider';
import {
  DEFAULT_PENALTY_RULESET_FORM_VALUES,
  PenaltyRulesetForm,
  type AccumulationScope,
  type BlackCardForfeitScope,
  type PenaltyRulesetFormValue,
} from '../../../../../../src/components/rulesets/PenaltyRulesetForm';

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

const BLANK_INITIAL: PenaltyRulesetFormValue = {
  name: '',
  description: '',
  code: '',
  version: '1.0.0',
  accumulationScope: 'match',
  publicVisibility: false,
  entries: [],
  ...DEFAULT_PENALTY_RULESET_FORM_VALUES,
};

interface PenaltyRulesetDetail {
  name: string;
  description: string | null;
  accumulation_scope: AccumulationScope;
  yellow_card_points?: number | null;
  red_card_points?: number | null;
  black_card_points?: number | null;
  first_black_card_forfeit?: BlackCardForfeitScope | null;
  second_black_card_forfeit?: BlackCardForfeitScope | null;
  penalty_ruleset_entries: Array<{
    group_number: number;
    ref_number: string;
    short_name: string;
    description: string;
    sanctions: Array<'yellow' | 'red' | 'black'>;
    sort_order: number;
  }>;
}

/** Pre-fill a fresh-create form from a ruleset being cloned: copy entries +
 *  card config, append "(copy)" to the name, leave the code blank so the
 *  organizer sets a unique one, and reset version + public visibility. */
function cloneInitial(data: PenaltyRulesetDetail): PenaltyRulesetFormValue {
  const sorted = [...(data.penalty_ruleset_entries ?? [])].sort(
    (a, b) => a.sort_order - b.sort_order,
  );
  return {
    name: `${data.name} (copy)`,
    description: data.description ?? '',
    code: '',
    version: '1.0.0',
    accumulationScope: data.accumulation_scope,
    publicVisibility: false,
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
    blackCardPoints: data.black_card_points ?? DEFAULT_PENALTY_RULESET_FORM_VALUES.blackCardPoints,
    firstBlackCardForfeit:
      data.first_black_card_forfeit ?? DEFAULT_PENALTY_RULESET_FORM_VALUES.firstBlackCardForfeit,
    secondBlackCardForfeit:
      data.second_black_card_forfeit ?? DEFAULT_PENALTY_RULESET_FORM_VALUES.secondBlackCardForfeit,
  };
}

export default function OrgNewPenaltyRulesetPage() {
  const params = useParams<{ slug: string }>();
  // See organizer-auth-decision.ts — guard against `undefined` getting
  // stringified into the slug segment of `<Link>` / router.push targets.
  const slugForLink = params.slug ?? '';
  const router = useRouter();
  const searchParams = useSearchParams();
  const cloneFrom = searchParams.get('cloneFrom');
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [initial, setInitial] = useState<PenaltyRulesetFormValue>(BLANK_INITIAL);
  // Wait for the clone source before rendering the form (it seeds once on mount).
  const [cloneLoading, setCloneLoading] = useState<boolean>(Boolean(cloneFrom));

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

  // Load the clone source (the detail endpoint serves built-in + org rulesets).
  useEffect(() => {
    if (!cloneFrom) return;
    let cancelled = false;
    void fetch(`${apiUrl}/api/v1/penalty-rulesets/${cloneFrom}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: PenaltyRulesetDetail | null) => {
        if (!cancelled && data) setInitial(cloneInitial(data));
      })
      .finally(() => {
        if (!cancelled) setCloneLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cloneFrom]);

  return (
    <main className="max-w-5xl p-8">
      <div className="mb-2 text-sm">
        <Link
          href={`/org/${slugForLink}/rulesets/penalty`}
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

      {cloneLoading ? (
        <p className="text-sm text-slate-400">{t('admin.rulesets.loading')}</p>
      ) : (
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
              router.push(`/org/${slugForLink}/rulesets/penalty/${created.id}/edit`);
            } catch (err) {
              setError(err instanceof Error ? err.message : t('admin.rulesets.actionFailed'));
              setBusy(false);
            }
          }}
          onCancel={() => router.push(`/org/${slugForLink}/rulesets/penalty`)}
        />
      )}
    </main>
  );
}
