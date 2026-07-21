'use client';

import { useCallback, useEffect, useState } from 'react';
import { t } from '@myclash/i18n';
import { useToast } from '@myclash/ui';
import { buildTfFromRow, type RulesetConfigTF, TF_DEFAULTS } from './buildTfFromRow';
import { TournamentVenuesEditor } from '../../_components/TournamentVenuesEditor';
import { TfRulesetControls } from '../../_shared/TfRulesetControls';
import { useCustomiseFormat } from '../../_shared/useCustomiseFormat';

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

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
  const toast = useToast();
  const [rulesetCode, setRulesetCode] = useState<string>('TF_v1');
  const [isSystem, setIsSystem] = useState(true);
  const [baseCode, setBaseCode] = useState<string | null>(null);
  const [tf, setTf] = useState<RulesetConfigTF>(TF_DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [publishOnFinish, setPublishOnFinish] = useState(false);

  const load = useCallback(() => {
    void fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((row) => {
        if (!row) return;
        setRulesetCode(row.ruleset_code);
        setIsSystem(row.ruleset_is_system ?? true);
        setBaseCode(row.ruleset_base_code ?? null);
        // Pluck-not-spread: see buildTfFromRow.ts for the rationale.
        setTf(
          buildTfFromRow(
            (row.ruleset_config ?? {}) as Partial<RulesetConfigTF> & Record<string, unknown>,
            TF_DEFAULTS,
          ),
        );
      });
  }, [tournamentId]);

  useEffect(() => {
    load();
  }, [load]);

  const { customise, customising, confirmDialog } = useCustomiseFormat(tournamentId, load);
  const tfLike = rulesetCode === 'TF_v1' || baseCode === 'TF_v1';

  async function saveAndFinish() {
    setSaving(true);
    try {
      // Always carries the step, so finishing the wizard is recorded even for
      // a ruleset with no TF-shaped config to send.
      const body: Record<string, unknown> = { wizardStep: 4 };
      if (tfLike) body['rulesetConfig'] = tf;
      const res = await fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new Error(`Save failed (${res.status}): ${errBody.slice(0, 200)}`);
      }
      onFinish(publishOnFinish);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error');
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
