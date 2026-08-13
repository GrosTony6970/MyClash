'use client';

import { useI18n } from '@myclash/next-i18n/client';
import { useCallback, useEffect, useState } from 'react';
import { useToast } from '@myclash/ui';
import {
  buildTfFromRow,
  TF_DEFAULTS,
  type RulesetConfigTF,
} from '../../../new/_wizard/buildTfFromRow';
import { TfRulesetControls } from '../../../_shared/TfRulesetControls';
import { useCustomiseFormat } from '../../../_shared/useCustomiseFormat';
import { isCodedRuleset } from '../../../../../../../../../src/components/rulesets/ruleset-kind';
import { getPublicApiUrl } from '@/lib/api-url';

const apiUrl = getPublicApiUrl();

export function AdvancedTab({ tournamentId }: { tournamentId: string }) {
  const { t } = useI18n();

  const toast = useToast();
  const [rulesetCode, setRulesetCode] = useState<string>('TF_v1');
  const [isSystem, setIsSystem] = useState(true);
  const [baseCode, setBaseCode] = useState<string | null>(null);
  const [tf, setTf] = useState<RulesetConfigTF>(TF_DEFAULTS);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    void fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((row) => {
        if (!row) return;
        setRulesetCode(row.ruleset_code);
        setIsSystem(row.ruleset_is_system ?? true);
        setBaseCode(row.ruleset_base_code ?? null);
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

  // Show the TF controls for the built-in TF_v1 AND for a fork of it (whose
  // code is no longer 'TF_v1' but whose base_code still is).
  const tfLike = isCodedRuleset(rulesetCode, baseCode);

  async function save() {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {};
      if (tfLike) body['rulesetConfig'] = tf;
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

      {tfLike && (
        <TfRulesetControls
          tf={tf}
          onChange={setTf}
          locked={isSystem}
          onCustomise={() => void customise()}
          customising={customising}
        />
      )}

      <button
        type="button"
        onClick={() => void save()}
        disabled={saving}
        className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground hover:bg-accent-hover disabled:opacity-50"
      >
        {saving ? t('common.saving') : t('organizer.tournaments.settings.save')}
      </button>
      {confirmDialog}
    </div>
  );
}
