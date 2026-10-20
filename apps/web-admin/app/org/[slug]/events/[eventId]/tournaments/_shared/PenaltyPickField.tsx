'use client';

import { useI18n } from '@myclash/next-i18n/client';

/**
 * A Tournament's penalty ruleset pick, in Step 1 of the wizard and on the Basics tab: the ONE
 * owner of its markup. Controlled; `''` is None, which plays the Event's ruleset, else the
 * built-in (the hint says so).
 */
export function PenaltyPickField({
  value,
  options,
  onChange,
}: {
  value: string;
  options: ReadonlyArray<{ id: string; name: string }>;
  onChange: (id: string) => void;
}) {
  const { t } = useI18n();
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-foreground-secondary">
        {t('organizer.tournaments.wizard.penaltyRuleset')}
        <span className="rounded bg-success/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-success">
          {t('organizer.tournaments.wizard.recommended')}
        </span>
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-border px-3 py-2 text-sm"
      >
        <option value="">{t('common.none')}</option>
        {options.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {!value && (
        <p className="mt-1 text-xs text-warning">
          {t('organizer.tournaments.wizard.penaltyRulesetBlankHint')}
        </p>
      )}
    </label>
  );
}
