'use client';

import { useEffect, useState } from 'react';
import { t } from '@myclash/i18n';
import { useToast } from '@myclash/ui';

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

interface RulesetConfigTF {
  winBonus: number;
  targetValues: { deepTarget: number; shallowTarget: number };
  /**
   * MUST stay `tournamentPolicy`. This block was keyed `forfeitPolicy`, which
   * collides with the rulesets-engine `forfeitPolicy.reasons.*` blob (same JSON
   * key, unrelated shape) — the wizard was migrated off it by migration 0062,
   * but this tab was not. Since `tournamentRulesetConfigSchema` is `.strict()`
   * and whitelists only `tournamentPolicy`, every TF_v1 save from here 400'd,
   * and hydration read a key the API never writes, so the fields always showed
   * defaults. Keep this shape aligned with the wizard's `buildTfFromRow`.
   */
  tournamentPolicy: {
    forfeitDrawsCount: boolean;
    forfeitFighterBefore1stMatch: boolean;
    disqualifyAfter: number;
  };
}

const TF_DEFAULTS: RulesetConfigTF = {
  winBonus: 3,
  targetValues: { deepTarget: 2, shallowTarget: 1 },
  tournamentPolicy: {
    forfeitDrawsCount: false,
    forfeitFighterBefore1stMatch: false,
    disqualifyAfter: 2,
  },
};

export function AdvancedTab({ tournamentId }: { tournamentId: string }) {
  const toast = useToast();
  const [rulesetCode, setRulesetCode] = useState<string>('TF_v1');
  const [tf, setTf] = useState<RulesetConfigTF>(TF_DEFAULTS);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((row) => {
        if (!row) return;
        setRulesetCode(row.ruleset_code);
        const rc = (row.ruleset_config ?? {}) as Partial<RulesetConfigTF>;
        setTf({
          winBonus: rc.winBonus ?? TF_DEFAULTS.winBonus,
          targetValues: { ...TF_DEFAULTS.targetValues, ...(rc.targetValues ?? {}) },
          tournamentPolicy: { ...TF_DEFAULTS.tournamentPolicy, ...(rc.tournamentPolicy ?? {}) },
        });
      });
  }, [tournamentId]);

  async function save() {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {};
      if (rulesetCode === 'TF_v1') body['rulesetConfig'] = tf;
      const res = await fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(t('admin.common.saveFailed'));
      toast.success(t('organizer.tournaments.settings.saved'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('admin.common.unknownError'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="font-display font-semibold text-lg sm:text-xl text-foreground">
        {t('organizer.tournaments.settings.advanced')}
      </h2>

      {rulesetCode === 'TF_v1' && (
        <fieldset className="space-y-3 rounded-md border border-border p-4">
          <legend className="px-2 text-xs font-medium text-foreground-secondary">
            {t('admin.orgTournaments.tfRulesetLegend')}
          </legend>
          <p className="px-2 pb-2 text-xs text-muted">{t('admin.orgTournaments.tfRulesetHint')}</p>
          <NumField
            label={t('admin.orgTournaments.winBonus')}
            value={tf.winBonus}
            defaultValue={TF_DEFAULTS.winBonus}
            onChange={(v) => setTf({ ...tf, winBonus: v })}
            onReset={() => setTf({ ...tf, winBonus: TF_DEFAULTS.winBonus })}
            min={0}
            max={20}
          />
          <NumField
            label={t('admin.orgTournaments.deepTarget')}
            value={tf.targetValues.deepTarget}
            defaultValue={TF_DEFAULTS.targetValues.deepTarget}
            onChange={(v) => setTf({ ...tf, targetValues: { ...tf.targetValues, deepTarget: v } })}
            onReset={() =>
              setTf({
                ...tf,
                targetValues: {
                  ...tf.targetValues,
                  deepTarget: TF_DEFAULTS.targetValues.deepTarget,
                },
              })
            }
            min={1}
            max={10}
          />
          <NumField
            label={t('admin.orgTournaments.shallowTarget')}
            value={tf.targetValues.shallowTarget}
            defaultValue={TF_DEFAULTS.targetValues.shallowTarget}
            onChange={(v) =>
              setTf({ ...tf, targetValues: { ...tf.targetValues, shallowTarget: v } })
            }
            onReset={() =>
              setTf({
                ...tf,
                targetValues: {
                  ...tf.targetValues,
                  shallowTarget: TF_DEFAULTS.targetValues.shallowTarget,
                },
              })
            }
            min={1}
            max={10}
          />
          <BoolField
            label={t('admin.orgTournaments.forfeitDrawsCount')}
            value={tf.tournamentPolicy.forfeitDrawsCount}
            defaultValue={TF_DEFAULTS.tournamentPolicy.forfeitDrawsCount}
            onChange={(v) =>
              setTf({ ...tf, tournamentPolicy: { ...tf.tournamentPolicy, forfeitDrawsCount: v } })
            }
            onReset={() =>
              setTf({
                ...tf,
                tournamentPolicy: {
                  ...tf.tournamentPolicy,
                  forfeitDrawsCount: TF_DEFAULTS.tournamentPolicy.forfeitDrawsCount,
                },
              })
            }
          />
          <BoolField
            label={t('admin.orgTournaments.forfeitBeforeFirstMatchDq')}
            value={tf.tournamentPolicy.forfeitFighterBefore1stMatch}
            defaultValue={TF_DEFAULTS.tournamentPolicy.forfeitFighterBefore1stMatch}
            onChange={(v) =>
              setTf({
                ...tf,
                tournamentPolicy: { ...tf.tournamentPolicy, forfeitFighterBefore1stMatch: v },
              })
            }
            onReset={() =>
              setTf({
                ...tf,
                tournamentPolicy: {
                  ...tf.tournamentPolicy,
                  forfeitFighterBefore1stMatch:
                    TF_DEFAULTS.tournamentPolicy.forfeitFighterBefore1stMatch,
                },
              })
            }
          />
          <NumField
            label={t('admin.orgTournaments.disqualifyAfter')}
            value={tf.tournamentPolicy.disqualifyAfter}
            defaultValue={TF_DEFAULTS.tournamentPolicy.disqualifyAfter}
            onChange={(v) =>
              setTf({ ...tf, tournamentPolicy: { ...tf.tournamentPolicy, disqualifyAfter: v } })
            }
            onReset={() =>
              setTf({
                ...tf,
                tournamentPolicy: {
                  ...tf.tournamentPolicy,
                  disqualifyAfter: TF_DEFAULTS.tournamentPolicy.disqualifyAfter,
                },
              })
            }
            min={1}
            max={10}
          />
        </fieldset>
      )}

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

function NumField({
  label,
  value,
  defaultValue,
  onChange,
  onReset,
  min,
  max,
}: {
  label: string;
  value: number;
  defaultValue?: number;
  onChange: (v: number) => void;
  onReset?: () => void;
  min: number;
  max: number;
}) {
  const modified = defaultValue !== undefined && value !== defaultValue;
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2 text-sm text-foreground-secondary">
        {label}
        {modified && (
          <span
            title={`Default: ${defaultValue}`}
            className="rounded-full bg-warning/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-warning"
          >
            {t('admin.orgTournaments.modifiedBadge')}
          </span>
        )}
      </span>
      <span className="flex items-center gap-2">
        {modified && onReset && (
          <button
            type="button"
            onClick={onReset}
            className="text-xs text-muted underline hover:text-foreground"
            title={`Reset to ${defaultValue}`}
          >
            {t('admin.orgTournaments.reset')}
          </button>
        )}
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-24 rounded-md border border-border px-3 py-1.5 text-sm"
        />
      </span>
    </label>
  );
}

function BoolField({
  label,
  value,
  defaultValue,
  onChange,
  onReset,
}: {
  label: string;
  value: boolean;
  defaultValue?: boolean;
  onChange: (v: boolean) => void;
  onReset?: () => void;
}) {
  const modified = defaultValue !== undefined && value !== defaultValue;
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2 text-sm text-foreground-secondary">
        {label}
        {modified && (
          <span
            title={`Default: ${String(defaultValue)}`}
            className="rounded-full bg-warning/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-warning"
          >
            {t('admin.orgTournaments.modifiedBadge')}
          </span>
        )}
      </span>
      <span className="flex items-center gap-2">
        {modified && onReset && (
          <button
            type="button"
            onClick={onReset}
            className="text-xs text-muted underline hover:text-foreground"
            title={`Reset to ${String(defaultValue)}`}
          >
            {t('admin.orgTournaments.reset')}
          </button>
        )}
        <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      </span>
    </label>
  );
}
