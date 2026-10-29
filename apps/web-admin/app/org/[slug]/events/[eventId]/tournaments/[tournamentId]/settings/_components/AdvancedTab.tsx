'use client';

import { useI18n } from '@myclash/next-i18n/client';
import { TF_FORM, tfForm } from '../../../_shared/tf-form';
import { TfRulesetControls } from '../../../_shared/TfRulesetControls';
import { RulesFormState } from '../../../_shared/RulesFormState';
import { useCustomiseFormat } from '../../../_shared/useCustomiseFormat';
import type { TabProps } from './tab-props';
import { useTabRules } from './useTabRules';

/**
 * TF_v1's own settings in force (`effectiveRules.tf`), for TF_v1 and a fork of it, and a Save of
 * only what the organiser changed (operator rulings 43, 46, 48, 52). A ruleset whose engine is
 * not TF_v1's has none: the API answers `tf: null`, and the tab shows no controls.
 */
export function AdvancedTab({ tournamentId, readOnly, readOnlyWhy, ...props }: TabProps) {
  const { t } = useI18n();
  const rules = useTabRules(tournamentId, TF_FORM, props);
  const { customise, customising, confirmDialog } = useCustomiseFormat(tournamentId, rules.reload);
  const tf = rules.form?.tf ?? null;
  const start = rules.rules?.start?.tf ? tfForm(rules.rules.start.tf) : null;

  return (
    <div className="space-y-6">
      <h2 className="font-display font-semibold text-lg sm:text-xl text-foreground">
        {t('organizer.tournaments.settings.advanced')}
      </h2>

      {rules.form ? (
        <>
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

          <button
            type="button"
            onClick={() => void rules.saveTab()}
            disabled={rules.saving || readOnly}
            title={readOnlyWhy}
            className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground hover:bg-accent-hover disabled:opacity-50"
          >
            {rules.saving ? t('common.saving') : t('organizer.tournaments.settings.save')}
          </button>
        </>
      ) : (
        <RulesFormState status={rules.status} onRetry={rules.reload} />
      )}
      {confirmDialog}
      {rules.auditDialog}
    </div>
  );
}
