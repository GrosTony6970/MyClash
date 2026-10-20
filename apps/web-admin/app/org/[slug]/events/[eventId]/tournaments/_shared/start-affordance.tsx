'use client';

import { useI18n } from '@myclash/next-i18n/client';
import { type ReactNode } from 'react';

/**
 * The "modified" badge and the Reset of a rules field: shown when its value is not the one the
 * ruleset starts a Tournament from at its pinned version (`start`, operator ruling 51), none
 * without a start value. Reset puts the start value back as it is. The ONE owner, for the Match
 * format tab and the TF_v1 controls. Both go outside the field's `<label>`: a button inside one
 * becomes what clicking the label's text presses.
 */
export function startAffordance<T>(
  value: T,
  start: T | undefined,
  label: (start: T) => string,
  onChange: (v: T) => void,
): { badge: ReactNode; reset: ReactNode } {
  if (start === undefined || value === start) return { badge: null, reset: null };
  const startLabel = label(start);
  return {
    badge: <ModifiedBadge startLabel={startLabel} />,
    reset: <ResetLink startLabel={startLabel} onReset={() => onChange(start)} />,
  };
}

/** A "modified" chip: the value is not the one the ruleset starts from. */
function ModifiedBadge({ startLabel }: { startLabel: string }) {
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

/** Its Reset link, which puts the start value back. */
function ResetLink({ startLabel, onReset }: { startLabel: string; onReset: () => void }) {
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
