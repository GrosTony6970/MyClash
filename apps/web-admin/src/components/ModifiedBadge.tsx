'use client';

import { useI18n } from '@myclash/next-i18n/client';

/**
 * The "modified" chip and the Reset link of a rules field: the ONE owner, for the rules a
 * Tournament starts from (`start-affordance.tsx`), its changes of its forfeit rules
 * (`TournamentForfeitRules.tsx`) and a ruleset's own values against the engine's
 * (`rulesets/RulesetFormFields.tsx`). Both go outside the field's `<label>`: a button inside one
 * becomes what clicking the label's text presses.
 */
export function ModifiedBadge({ startLabel }: { startLabel: string }) {
  const { t } = useI18n();

  return (
    <span
      title={t('admin.orgTournaments.defaultValue', { value: startLabel })}
      className="rounded-full bg-warning/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-warning"
    >
      {t('admin.orgTournaments.modifiedBadge')}
    </span>
  );
}

/** Its Reset link, which puts the value it names back. */
export function ResetLink({ startLabel, onReset }: { startLabel: string; onReset: () => void }) {
  const { t } = useI18n();

  return (
    <button
      type="button"
      onClick={onReset}
      className="text-xs text-muted underline hover:text-foreground"
      title={t('admin.orgTournaments.resetTo', { value: startLabel })}
    >
      {t('admin.orgTournaments.reset')}
    </button>
  );
}
