'use client';

import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import { apiRequest, failureMessage } from '@myclash/api-client';
import {
  DEFAULT_PENALTY_RULESET_FORM_VALUES,
  PenaltyRulesetForm,
  type AccumulationScope,
  type BlackCardForfeitScope,
  type PenaltyRulesetFormValue,
} from '../../../../../../src/components/rulesets/PenaltyRulesetForm';
import { getPublicApiUrl } from '@/lib/api-url';
import { BackLink } from '@/components/BackLink';

const apiUrl = getPublicApiUrl();

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
  // stringified into the slug segment of link hrefs / router.push targets.
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
    void apiRequest<{ id: string }>(
      apiUrl,
      `/api/v1/organizations/slug/${encodeURIComponent(params.slug)}`,
    ).then((r) => {
      if (cancelled) return;
      if (r.ok) {
        setOrgId(r.data.id);
        return;
      }
      const message = failureMessage(r, t, t('admin.penaltyRulesets.loadError'));
      if (message) setError(message);
    });
    return () => {
      cancelled = true;
    };
  }, [params.slug, t]);

  // Load the clone source (the detail endpoint serves built-in + org rulesets).
  useEffect(() => {
    if (!cloneFrom) return;
    let cancelled = false;
    void apiRequest<PenaltyRulesetDetail>(apiUrl, `/api/v1/penalty-rulesets/${cloneFrom}`)
      .then((r) => {
        // A clone source that will not load leaves a blank create form, which
        // is still usable — same silence as before.
        if (!cancelled && r.ok) setInitial(cloneInitial(r.data));
      })
      .finally(() => {
        if (!cancelled) setCloneLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cloneFrom]);

  return (
    <main className="mx-auto w-full max-w-5xl p-8">
      <BackLink
        href={`/org/${slugForLink}/rulesets/penalty`}
        label={t('admin.rulesets.backToList')}
        className="mb-2"
      />
      <h1 className="mb-1 font-display font-bold text-2xl sm:text-3xl text-foreground">
        {t('admin.penaltyRulesets.createTitle')}
      </h1>
      <p className="mb-6 text-sm text-muted">{t('admin.penaltyRulesets.createDescription')}</p>

      {error && (
        <div className="mb-4 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {cloneLoading ? (
        <p className="text-sm text-muted">{t('admin.rulesets.loading')}</p>
      ) : (
        <PenaltyRulesetForm
          initial={initial}
          busy={busy || !orgId}
          submitLabel={t('admin.penaltyRulesets.createButton')}
          onSubmit={(data) =>
            void (async () => {
              if (!orgId) return;
              setBusy(true);
              setError(null);
              const r = await apiRequest<{ id: string }>(apiUrl, '/api/v1/penalty-rulesets', {
                method: 'POST',
                body: { ownerOrganizationId: orgId, ...data },
              });
              if (!r.ok) {
                const message = failureMessage(r, t, t('admin.rulesets.actionFailed'));
                if (message) setError(message);
                setBusy(false);
                return;
              }
              router.push(`/org/${slugForLink}/rulesets/penalty/${r.data.id}/edit`);
            })()
          }
          onCancel={() => router.push(`/org/${slugForLink}/rulesets/penalty`)}
        />
      )}
    </main>
  );
}
