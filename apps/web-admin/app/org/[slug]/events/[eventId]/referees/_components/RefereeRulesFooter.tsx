'use client';

import { useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';

/**
 * The health panel's rules footer: the rules an operator can switch, and ADR-019's two
 * numbers. Keys match the PUT pool-assignment-settings payload field names.
 *
 * The Discouraged switches of ADR-016 (own Pool, Pool running, two roles, attending a
 * Workshop), rest between duties (ADR-019) and the capacity warning's. The Impossible
 * rules have no switch anywhere (hard rule 8): their old columns went with 0209, and the
 * settings body refuses their keys.
 */
export const RULE_KEYS = [
  'enableOwnPoolRule',
  'enableOwnPoolSpanRule',
  'enableTwoRolesRule',
  'workshopConflictWarning',
  'enforceRefereeNoBackToBack',
  'enableCapacityRule',
] as const;
export type RuleKey = (typeof RULE_KEYS)[number];

/** ADR-019's two numbers: rest in day slots (0–5), and the daily bout cap (0 = none). */
export type NumberRuleKey = 'refereeRestMinSlots' | 'maxBoutsPerDay';
export type RuleSettings = Record<RuleKey, boolean> & Record<NumberRuleKey, number>;
export type RuleChange = <K extends keyof RuleSettings>(key: K, value: RuleSettings[K]) => void;

/** i18n suffix per rule under organizer.refereesPage.rules.* */
const RULE_I18N: Record<RuleKey, string> = {
  enableOwnPoolRule: 'ownPool',
  enableOwnPoolSpanRule: 'ownPoolSpan',
  enableTwoRolesRule: 'twoRoles',
  workshopConflictWarning: 'attendWorkshop',
  enforceRefereeNoBackToBack: 'rest',
  enableCapacityRule: 'capacity',
};

/** The panel's colours for this footer, from its health status. */
interface Tone {
  item: string;
  sublabel: string;
}

/**
 * A rule's number, sent when the field is left or Enter is pressed — not per keystroke:
 * typing "12" would send 1 then 12, and two PUTs in flight may land in either order.
 * Out of range or empty snaps back to what the server holds.
 */
function RuleNumber({
  label,
  value,
  max,
  disabled,
  onCommit,
}: {
  label: string;
  value: number;
  max: number;
  disabled: boolean | undefined;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const next = Number(draft);
    setDraft(null);
    if (
      draft.trim() !== '' &&
      Number.isInteger(next) &&
      next >= 0 &&
      next <= max &&
      next !== value
    ) {
      onCommit(next);
    }
  };
  return (
    <label className="mt-1 flex items-center gap-2 text-[11px]">
      <span>{label}</span>
      <input
        type="number"
        min={0}
        max={max}
        step={1}
        value={draft ?? String(value)}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
        className="w-16 rounded border border-border bg-surface px-1.5 py-0.5 text-foreground"
      />
    </label>
  );
}

/** One switchable rule; rest carries its number of slots while it is on. */
function RuleSwitch({
  ruleKey,
  settings,
  onChange,
  disabled,
  tone,
}: {
  ruleKey: RuleKey;
  settings: RuleSettings;
  onChange: RuleChange | undefined;
  disabled: boolean | undefined;
  tone: Tone;
}) {
  const { t } = useI18n();
  return (
    <li>
      <label
        className={`flex items-start gap-2 ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
      >
        <input
          type="checkbox"
          checked={settings[ruleKey]}
          disabled={disabled}
          onChange={(e) => onChange?.(ruleKey, e.target.checked)}
          className="mt-0.5 rounded"
        />
        <span>
          <span className={`block text-xs font-semibold ${tone.item}`}>
            {t(`organizer.refereesPage.rules.${RULE_I18N[ruleKey]}.label`)}
          </span>
          <span className={`block text-[11px] ${tone.sublabel}`}>
            {t(`organizer.refereesPage.rules.${RULE_I18N[ruleKey]}.description`)}
          </span>
        </span>
      </label>
      {ruleKey === 'enforceRefereeNoBackToBack' && settings[ruleKey] && (
        <RuleNumber
          label={t('organizer.refereesPage.rules.rest.slots')}
          value={settings.refereeRestMinSlots}
          max={5}
          disabled={disabled}
          onCommit={(n) => onChange?.('refereeRestMinSlots', n)}
        />
      )}
    </li>
  );
}

export function RefereeRulesFooter({
  settings,
  onChange,
  disabled,
  tone,
}: {
  settings: RuleSettings;
  onChange: RuleChange | undefined;
  disabled: boolean | undefined;
  tone: Tone;
}) {
  const { t } = useI18n();
  return (
    <div className="mt-3 border-t pt-2">
      <p className={`mb-1.5 text-[11px] font-semibold uppercase tracking-wider ${tone.sublabel}`}>
        {t('organizer.refereesPage.rules.title')}
      </p>
      <ul className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
        {RULE_KEYS.map((key) => (
          <RuleSwitch key={key} ruleKey={key} {...{ settings, onChange, disabled, tone }} />
        ))}
        <li className={tone.item}>
          <RuleNumber
            label={t('organizer.refereesPage.rules.cap.label')}
            value={settings.maxBoutsPerDay}
            max={200}
            disabled={disabled}
            onCommit={(n) => onChange?.('maxBoutsPerDay', n)}
          />
          <span className={`block text-[11px] ${tone.sublabel}`}>
            {t('organizer.refereesPage.rules.cap.description')}
          </span>
        </li>
      </ul>
    </div>
  );
}
