'use client';

import { useI18n } from '@myclash/next-i18n/client';
import { type ReactNode } from 'react';
import { Switch, useToast } from '@myclash/ui';
import type { TournamentLockConfig } from '@myclash/types';
import { RulesFormState } from '../../../_shared/RulesFormState';
import { useEffectiveRules, type RulesFormSpec } from '../../../_shared/useEffectiveRules';
import type { TabProps } from './tab-props';

/** The auto-lock in force (`effectiveRules.lock`: what the auto-lock worker applies). */
const LOCK_FORM: RulesFormSpec<TournamentLockConfig> = {
  formOf: (rules) => ({ ...rules.lock }),
  bodyOf: (lock) => ({ lockConfig: lock }),
};

export function LocksTab({ tournamentId, readOnly, onDirtyChange }: TabProps) {
  const { t } = useI18n();

  const toast = useToast();
  const rules = useEffectiveRules(tournamentId, LOCK_FORM, onDirtyChange);
  const { form: lock, setForm: setLock } = rules;

  async function save() {
    if ((await rules.save()) === 'saved') toast.success(t('organizer.tournaments.settings.saved'));
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display font-semibold text-lg sm:text-xl text-foreground">
          {t('organizer.tournaments.settings.locks')}
        </h2>
        <p className="mt-1 text-sm text-muted">
          {t('organizer.tournaments.settings.lockHelp.intro')}
        </p>
        <p className="mt-1 text-sm text-muted">
          {t('organizer.tournaments.settings.lockHelp.lockedNote')}
        </p>
      </div>

      {lock ? (
        <LockFields
          lock={lock}
          onChange={setLock}
          saving={rules.saving}
          readOnly={readOnly}
          onSave={() => void save()}
        />
      ) : (
        <RulesFormState status={rules.status} onRetry={rules.reload} />
      )}
    </div>
  );
}

/** The auto-lock switches and their Save, drawn once the rules in force are read. */
function LockFields({
  lock,
  onChange: setLock,
  saving,
  readOnly,
  onSave,
}: {
  lock: TournamentLockConfig;
  onChange: (next: TournamentLockConfig) => void;
  saving: boolean;
  readOnly: boolean;
  onSave: () => void;
}) {
  const { t } = useI18n();
  const dependentDisabled = !lock.autoLockEnabled;
  return (
    <>
      <fieldset className="space-y-4 rounded-md border border-border p-4">
        <legend className="px-2 text-xs font-medium text-foreground-secondary">
          {t('organizer.tournaments.settings.locks')}
        </legend>

        {/* Master switch */}
        <SettingRow
          label={t('organizer.tournaments.settings.lockHelp.enabled')}
          help={t('organizer.tournaments.settings.lockHelp.enabledHelp')}
          control={
            <Switch
              checked={lock.autoLockEnabled}
              onChange={(v) => setLock({ ...lock, autoLockEnabled: v })}
              ariaLabel={t('organizer.tournaments.settings.lockHelp.enabled')}
            />
          }
        />

        {/* Dependent settings — greyed out + disabled until the master is on */}
        <div
          aria-disabled={dependentDisabled}
          className={`space-y-4 border-t border-border pt-4 ${
            dependentDisabled ? 'pointer-events-none opacity-50' : ''
          }`}
        >
          <SettingRow
            label={t('organizer.tournaments.settings.lockHelp.delay')}
            help={t('organizer.tournaments.settings.lockHelp.delayHelp')}
            control={
              <input
                type="number"
                value={lock.autoLockDelayMinutes}
                min={0}
                max={1440}
                disabled={dependentDisabled}
                onChange={(e) => setLock({ ...lock, autoLockDelayMinutes: Number(e.target.value) })}
                className="w-24 rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-50"
              />
            }
          />
          <SettingRow
            label={t('organizer.tournaments.settings.lockHelp.completedPools')}
            help={t('organizer.tournaments.settings.lockHelp.completedPoolsHelp')}
            control={
              <Switch
                checked={lock.autoLockCompletedPools}
                onChange={(v) => setLock({ ...lock, autoLockCompletedPools: v })}
                disabled={dependentDisabled}
                ariaLabel={t('organizer.tournaments.settings.lockHelp.completedPools')}
              />
            }
          />
          <SettingRow
            label={t('organizer.tournaments.settings.lockHelp.completedBrackets')}
            help={t('organizer.tournaments.settings.lockHelp.completedBracketsHelp')}
            control={
              <Switch
                checked={lock.autoLockCompletedBrackets}
                onChange={(v) => setLock({ ...lock, autoLockCompletedBrackets: v })}
                disabled={dependentDisabled}
                ariaLabel={t('organizer.tournaments.settings.lockHelp.completedBrackets')}
              />
            }
          />
        </div>
      </fieldset>

      <button
        type="button"
        onClick={onSave}
        disabled={saving || readOnly}
        title={readOnly ? t('organizer.deletionRequest.archivedReadOnly') : undefined}
        className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground hover:bg-accent-hover disabled:opacity-50"
      >
        {saving ? t('common.saving') : t('organizer.tournaments.settings.save')}
      </button>
    </>
  );
}

/** A settings row: label + muted help on the left, the control on the right. */
function SettingRow({ label, help, control }: { label: string; help: string; control: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col">
        <span className="text-sm text-foreground-secondary">{label}</span>
        <span className="text-xs text-muted">{help}</span>
      </div>
      <div className="mt-0.5 flex-shrink-0">{control}</div>
    </div>
  );
}
