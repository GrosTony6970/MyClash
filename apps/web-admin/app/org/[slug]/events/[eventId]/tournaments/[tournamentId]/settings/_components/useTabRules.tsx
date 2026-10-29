'use client';

import { useI18n } from '@myclash/next-i18n/client';
import { useToast } from '@myclash/ui';
import { useRef } from 'react';
import { useEffectiveRules, type RulesFormSpec } from '../../../_shared/useEffectiveRules';
import { RulesChangeDialog } from './RulesChangeDialog';
import type { TabProps } from './tab-props';
import { storedRulesOf } from './useRepinDialog';
import { useRulesChangeDialog, type RulesHost } from './useRulesChangeDialog';

/**
 * A settings tab's rules (`useEffectiveRules`) with the rules-change dialog mounted on them (the
 * audited settings change, revision 13 §6; Pass 6 item 2). A locked change opens the dialog; a
 * save, plain or audited, has the page read its drift banner again (`onRulesSaved`).
 *
 * The races handled: the answer of an audited save that lands after a newer read of the tab
 * started (Retry, "Customise this format") is dropped, form and row: the newer read's stand, as a
 * plain save's answer is (`useEffectiveRules`). The read after a save that could not read its row
 * back is dropped too when a plain save answered since: that save's row is the newer one.
 */
export function useTabRules<F>(
  tournamentId: string,
  spec: RulesFormSpec<F>,
  { onDirtyChange, onRulesSaved }: Pick<TabProps, 'onDirtyChange' | 'onRulesSaved'>,
) {
  const { t } = useI18n();
  const toast = useToast();
  const dialog = useRulesChangeDialog<F>(tournamentId);
  const rules = useEffectiveRules(tournamentId, spec, onDirtyChange, dialog.open);
  const { row, generation, setSaved, setRow } = rules;
  // The plain saves answered: with the read generation, which state a late answer meets.
  const plainSaves = useRef(0);
  const stamp = () => `${generation()}/${plainSaves.current}`;

  const host = (): RulesHost<F> => {
    if (!row) throw new Error('The rules-change dialog confirmed before the tab read its row.');
    const at = generation();
    const take = (taken: Record<string, unknown>) => setRow((before) => ({ ...before, ...taken }));
    return {
      stored: storedRulesOf(row),
      saved: (written, sent) => {
        if (generation() !== at) return;
        setSaved(sent);
        if (written) take(written);
      },
      stamp,
      reread: (read, readAt) => {
        if (stamp() === readAt) take(read);
      },
      onRulesSaved,
    };
  };

  async function saveTab() {
    if ((await rules.save()) !== 'saved') return;
    plainSaves.current++;
    toast.success(t('organizer.tournaments.settings.saved'));
    onRulesSaved?.();
  }

  const auditDialog = row ? (
    <RulesChangeDialog dialog={dialog} tournamentName={String(row['name'] ?? '')} host={host} />
  ) : null;
  return { ...rules, saveTab, auditDialog };
}
