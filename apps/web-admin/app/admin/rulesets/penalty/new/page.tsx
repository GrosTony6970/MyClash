'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useI18n } from '../../../../../src/i18n/I18nProvider';
import {
  DEFAULT_PENALTY_RULESET_FORM_VALUES,
  PenaltyRulesetForm,
  type PenaltyRulesetFormValue,
} from '../../../../../src/components/rulesets/PenaltyRulesetForm';

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

/**
 * Admin-side create page. The platform itself has no `owner_organization_id`,
 * but the existing `CreatePenaltyRulesetDto` requires one. As a pragmatic
 * shim we still send the current super-admin's primary org id — the
 * organizer-facing flow does the right thing for org-owned rulesets, and
 * platform-level penalty rulesets are currently driven by the migration seed
 * (FFAMHE) rather than this UI. A follow-up can add a nullable owner path.
 */
const ADMIN_PLATFORM_OWNER_PLACEHOLDER = '00000000-0000-0000-0000-000000000000';

export default function NewPenaltyRulesetPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        <Link href="/admin/rulesets/penalty" className="text-muted hover:underline">
          {t('admin.rulesets.backToList')}
        </Link>
      </div>
      <h1 className="mb-1 font-display font-bold text-2xl sm:text-3xl text-foreground">
        {t('admin.penaltyRulesets.createTitle')}
      </h1>
      <p className="mb-6 text-sm text-muted">{t('admin.penaltyRulesets.createDescription')}</p>

      {error && (
        <div className="mb-4 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      <PenaltyRulesetForm
        initial={initial}
        busy={busy}
        submitLabel={t('admin.penaltyRulesets.createButton')}
        onSubmit={async (data) => {
          setBusy(true);
          setError(null);
          try {
            const res = await fetch(`${apiUrl}/api/v1/penalty-rulesets`, {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ownerOrganizationId: ADMIN_PLATFORM_OWNER_PLACEHOLDER,
                ...data,
              }),
            });
            if (!res.ok) {
              const body = (await res.json().catch(() => ({}))) as { message?: string };
              throw new Error(body.message ?? t('admin.rulesets.actionFailed'));
            }
            const created = (await res.json()) as { id: string };
            router.push(`/admin/rulesets/penalty/${created.id}/edit`);
          } catch (err) {
            setError(err instanceof Error ? err.message : t('admin.rulesets.actionFailed'));
            setBusy(false);
          }
        }}
        onCancel={() => router.push('/admin/rulesets/penalty')}
      />
    </main>
  );
}
