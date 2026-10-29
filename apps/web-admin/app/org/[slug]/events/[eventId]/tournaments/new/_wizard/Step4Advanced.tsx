'use client';

import { useI18n } from '@myclash/next-i18n/client';
import { useState } from 'react';
import { TournamentVenuesEditor } from '../../_components/TournamentVenuesEditor';
import { TF_FORM, tfForm } from '../../_shared/tf-form';
import { TfRulesetControls } from '../../_shared/TfRulesetControls';
import { RulesFormState } from '../../_shared/RulesFormState';
import { useCustomiseFormat } from '../../_shared/useCustomiseFormat';
import { useEffectiveRules } from '../../_shared/useEffectiveRules';
import { RulesChangeElsewhere } from './RulesChangeElsewhere';

/**
 * TF_v1's own settings in force (`effectiveRules.tf`), for TF_v1 and a fork of it, and a Finish
 * that sends only what the organiser changed, with the step (operator rulings 43, 46, 48, 52). When
 * the rules cannot be read, "finish with defaults" stays the way out.
 */
export function Step4Advanced({
  tournamentId,
  eventId,
  onBack,
  onFinish,
  readOnly,
}: {
  tournamentId: string;
  eventId: string;
  onBack: () => void;
  /** Resolves once the finish (and its publish) has answered: the buttons stay closed till then. */
  onFinish: (publish: boolean) => Promise<void>;
  /** The Event is archived: the server refuses the step's saves, so they are closed. */
  readOnly: boolean;
}) {
  const { t } = useI18n();

  const rules = useEffectiveRules(tournamentId, TF_FORM);
  const [finishing, setFinishing] = useState(false);
  const [publishOnFinish, setPublishOnFinish] = useState(false);
  const { customise, customising, confirmDialog } = useCustomiseFormat(tournamentId, rules.reload);
  const tf = rules.form?.tf ?? null;
  const start = rules.rules?.start?.tf ? tfForm(rules.rules.start.tf) : null;
  const busy = finishing || rules.saving;

  async function saveAndFinish() {
    // Always carries the step, so finishing the wizard is recorded even when nothing changed.
    if ((await rules.save({ wizardStep: 4 })) !== 'saved') return;
    setFinishing(true);
    try {
      await onFinish(publishOnFinish);
    } finally {
      setFinishing(false);
    }
  }

  /**
   * Skips this step's own save; holds the buttons until the finish has answered. On an
   * archived Event it is the way out of the wizard (ruling 377): it publishes nothing.
   */
  async function finishWithDefaults() {
    setFinishing(true);
    try {
      await onFinish(publishOnFinish && !readOnly);
    } finally {
      setFinishing(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="mb-4 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm">
        <button
          type="button"
          onClick={() => void finishWithDefaults()}
          disabled={busy}
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
        <TournamentVenuesEditor
          tournamentId={tournamentId}
          eventId={eventId}
          readOnly={readOnly}
          readOnlyWhy={readOnly ? t('organizer.deletionRequest.archivedReadOnly') : undefined}
        />
      </div>

      {!rules.form && <RulesFormState status={rules.status} onRetry={rules.reload} />}
      {tf && (
        <TfRulesetControls
          tf={tf}
          start={start}
          onChange={(next) => rules.setForm({ tf: next })}
          locked={rules.row?.['ruleset_is_system'] !== false}
          onCustomise={() => void customise()}
          customising={customising}
          readOnly={readOnly}
        />
      )}

      {rules.needsAudit && <RulesChangeElsewhere tournamentId={tournamentId} tab="advanced" />}
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
          disabled={busy || readOnly || !rules.form}
          title={readOnly ? t('organizer.deletionRequest.archivedReadOnly') : undefined}
          className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground hover:bg-accent-hover disabled:opacity-50"
        >
          {busy ? t('common.saving') : t('organizer.tournaments.wizard.finish')}
        </button>
      </div>
      {confirmDialog}
    </div>
  );
}
