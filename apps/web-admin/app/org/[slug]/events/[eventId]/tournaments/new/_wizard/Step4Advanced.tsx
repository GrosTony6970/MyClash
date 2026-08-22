'use client';

import { useI18n } from '@myclash/next-i18n/client';
import { useCallback, useEffect, useState } from 'react';
import { useToast } from '@myclash/ui';
import { buildTfFromRow, type RulesetConfigTF, TF_DEFAULTS } from './buildTfFromRow';
import { TournamentVenuesEditor } from '../../_components/TournamentVenuesEditor';
import { TfRulesetControls } from '../../_shared/TfRulesetControls';
import { useCustomiseFormat } from '../../_shared/useCustomiseFormat';
import { isCodedRuleset } from '../../../../../../../../src/components/rulesets/ruleset-kind';
import { apiRequest, failureMessage } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';

const apiUrl = getPublicApiUrl();

export function Step4Advanced({
  tournamentId,
  eventId,
  onBack,
  onFinish,
}: {
  tournamentId: string;
  eventId: string;
  onBack: () => void;
  onFinish: (publish: boolean) => void;
}) {
  const { t } = useI18n();

  const toast = useToast();
  const [rulesetCode, setRulesetCode] = useState<string>('TF_v1');
  const [isSystem, setIsSystem] = useState(true);
  const [baseCode, setBaseCode] = useState<string | null>(null);
  const [tf, setTf] = useState<RulesetConfigTF>(TF_DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [publishOnFinish, setPublishOnFinish] = useState(false);

  const load = useCallback(() => {
    // Silent read: the step shows the coded defaults until the row lands, and
    // the save below reports its own refusal.
    void apiRequest<Record<string, unknown>>(apiUrl, `/api/v1/tournaments/${tournamentId}`).then(
      (r) => {
        if (!r.ok) return;
        const row = r.data;
        setRulesetCode(row['ruleset_code'] as string);
        setIsSystem((row['ruleset_is_system'] as boolean | undefined) ?? true);
        setBaseCode((row['ruleset_base_code'] as string | null | undefined) ?? null);
        // Pluck-not-spread: see buildTfFromRow.ts for the rationale.
        setTf(
          buildTfFromRow(
            (row['ruleset_config'] ?? {}) as Partial<RulesetConfigTF> & Record<string, unknown>,
            TF_DEFAULTS,
          ),
        );
      },
    );
  }, [tournamentId]);

  useEffect(() => {
    load();
  }, [load]);

  const { customise, customising, confirmDialog } = useCustomiseFormat(tournamentId, load);
  // The built-in TF_v1 or a fork of it — one shared predicate so the literal
  // does not drift across the wizard and the ruleset authoring surfaces.
  const tfLike = isCodedRuleset(rulesetCode, baseCode);

  async function saveAndFinish() {
    setSaving(true);
    try {
      // Always carries the step, so finishing the wizard is recorded even for
      // a ruleset with no TF-shaped config to send.
      const body: Record<string, unknown> = { wizardStep: 4 };
      if (tfLike) body['rulesetConfig'] = tf;
      const r = await apiRequest(apiUrl, `/api/v1/tournaments/${tournamentId}`, {
        method: 'PATCH',
        body,
      });
      if (!r.ok) {
        // This built `Save failed (400): {"statusCode":400,"code":...` by hand
        // — the status code AND 200 raw bytes of the problem+json envelope,
        // pasted into a toast, in English only. Both of those strings were
        // hardcoded, which hard rule 6 forbids.
        const message = failureMessage(r, t, t('admin.common.saveFailed'));
        if (message) toast.error(message);
        return;
      }
      onFinish(publishOnFinish);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="mb-4 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm">
        <button
          type="button"
          onClick={() => onFinish(false)}
          className="font-medium text-warning hover:underline"
        >
          {t('organizer.tournaments.wizard.useDefaultsAndFinish')} →
        </button>
      </div>

      <h2 className="font-display font-semibold text-lg sm:text-xl text-foreground">
        {t('organizer.tournaments.wizard.advanced')}
      </h2>
      <p className="text-xs text-muted">{t('admin.orgTournaments.advancedWizardHint')}</p>

      <div className="rounded-md border border-border p-4">
        <TournamentVenuesEditor tournamentId={tournamentId} eventId={eventId} />
      </div>

      {tfLike && (
        <TfRulesetControls
          tf={tf}
          onChange={setTf}
          locked={isSystem}
          onCustomise={() => void customise()}
          customising={customising}
        />
      )}

      <div className="flex items-center gap-3 justify-between mt-6">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground-secondary hover:bg-background"
        >
          {t('actions.back')}
        </button>
        <label className="flex items-center gap-2 text-xs text-foreground-secondary">
          <input
            type="checkbox"
            checked={publishOnFinish}
            onChange={(e) => setPublishOnFinish(e.target.checked)}
          />
          {t('organizer.tournaments.wizard.publishOnFinish')}
        </label>
        <button
          type="button"
          onClick={() => void saveAndFinish()}
          disabled={saving}
          className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground hover:bg-accent-hover disabled:opacity-50"
        >
          {saving ? t('common.saving') : t('organizer.tournaments.wizard.finish')}
        </button>
      </div>
      {confirmDialog}
    </div>
  );
}
