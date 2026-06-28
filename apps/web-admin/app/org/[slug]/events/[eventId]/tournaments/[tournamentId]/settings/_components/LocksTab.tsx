'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { t } from '@myclash/i18n';
import { Switch, useToast } from '@myclash/ui';

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

interface LockConfig {
  autoLockEnabled: boolean;
  autoLockDelayMinutes: number;
  autoLockCompletedPools: boolean;
  autoLockCompletedBrackets: boolean;
}

const LOCK_DEFAULTS: LockConfig = {
  autoLockEnabled: false,
  autoLockDelayMinutes: 30,
  autoLockCompletedPools: false,
  autoLockCompletedBrackets: false,
};

export function LocksTab({ tournamentId }: { tournamentId: string }) {
  const toast = useToast();
  const [lock, setLock] = useState<LockConfig>(LOCK_DEFAULTS);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((row) => {
        if (!row) return;
        const lc = (row.lock_config ?? {}) as Partial<LockConfig>;
        setLock({
          autoLockEnabled: lc.autoLockEnabled ?? LOCK_DEFAULTS.autoLockEnabled,
          autoLockDelayMinutes: lc.autoLockDelayMinutes ?? LOCK_DEFAULTS.autoLockDelayMinutes,
          autoLockCompletedPools: lc.autoLockCompletedPools ?? LOCK_DEFAULTS.autoLockCompletedPools,
          autoLockCompletedBrackets:
            lc.autoLockCompletedBrackets ?? LOCK_DEFAULTS.autoLockCompletedBrackets,
        });
      });
  }, [tournamentId]);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lockConfig: lock }),
      });
      if (!res.ok) throw new Error('Save failed');
      toast.success(t('organizer.tournaments.settings.saved'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error');
    } finally {
      setSaving(false);
    }
  }

  const dependentDisabled = !lock.autoLockEnabled;

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
        onClick={() => void save()}
        disabled={saving}
        className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground hover:bg-accent-hover disabled:opacity-50"
      >
        {saving ? t('common.saving') : t('organizer.tournaments.settings.save')}
      </button>
    </div>
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
