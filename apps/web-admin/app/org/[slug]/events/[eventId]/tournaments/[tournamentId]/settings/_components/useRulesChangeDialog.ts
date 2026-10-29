'use client';

import { useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import { useToast } from '@myclash/ui';
import { apiRequest, failureMessage } from '@myclash/api-client';
import { RULES_SAVE_KEYS, type RulesExpected } from '@myclash/types';
import { getPublicApiUrl } from '@/lib/api-url';
import { rulesChangeRefusal } from '@/lib/rules-change-refusal';
import type { RefusedRulesSave } from '../../../_shared/useEffectiveRules';
import type { ConfirmWords } from './RulesConfirm';
import type { StoredRules } from './useRepinDialog';

const apiUrl = getPublicApiUrl();

type Row = Record<string, unknown>;

/** A Fighter of the answer: a name, or null when it could not be read. */
export interface NamedFighter {
  registrationId: string;
  name: string | null;
}

/** What the audited save says of the Fighters' follow (ruling 144). */
export interface FollowReport {
  notSettled: NamedFighter[];
  inStep: NamedFighter[];
  handOffFailed: boolean;
  followFailed: boolean;
}

interface AuditedAnswer {
  tournament: Row | null;
  rulesetChange: FollowReport & { readBackFailed: boolean };
}

/**
 * What the dialog needs of the tab that hosts it, built when the organiser confirms. The tab
 * owns its race: it drops a row that lands after a newer read or save of its own (`stamp`).
 */
export interface RulesHost<S = unknown> {
  /** The stored name and raw rules the tab last knew: the resend carries them back. */
  stored: StoredRules;
  /** The audited save landed: mark `sent` saved, and take the row it read back (null: none). */
  saved: (row: Row | null, sent: S) => void;
  /** Which read or save of the tab the state comes from now: compared with `===`. */
  stamp: () => unknown;
  /** A read of the row after a save that could not read it back, sent at `stamp() === at`. */
  reread: (row: Row, at: unknown) => void;
  onRulesSaved?: () => void;
}

/** Something to report (ruling 165): the result view stays open on it. */
const hasReport = (r: FollowReport) =>
  r.notSettled.length > 0 || r.inStep.length > 0 || r.handOffFailed || r.followFailed;

/** The refused body's rules keys alone (`RULES_SAVE_KEYS`): the pair and the card pin never. */
const rulesKeysOf = (body: Row): Row =>
  Object.fromEntries(
    Object.entries(body).filter(([key]) => (RULES_SAVE_KEYS as readonly string[]).includes(key)),
  );

/** The resend: the refused body's rules keys, with the reason, the typed name and `expected`. */
const resend = (path: string, body: Row, words: ConfirmWords, expected: RulesExpected) =>
  apiRequest<AuditedAnswer>(apiUrl, path, {
    method: 'PATCH',
    body: {
      ...rulesKeysOf(body),
      audit: { justification: words.justification, confirm: words.typedName, expected },
    },
  });

/**
 * Reads the row again after a save that could not read it back; false when this read fails or
 * stalls (15 s): the page then says to reload, never nothing.
 */
async function rereadRow<S>(path: string, host: RulesHost<S>): Promise<boolean> {
  const at = host.stamp();
  const r = await apiRequest<Row>(apiUrl, path, { signal: AbortSignal.timeout(15_000) });
  if (r.ok) host.reread(r.data, at);
  return r.ok;
}

/**
 * A settings change the lock refused (`rules_change_needs_audit`; the audited settings change,
 * revision 13 §6, rulings 144, 162-169). `open` takes the refusal; `confirm` resends the refused
 * body's rules keys with the reason, the typed name and the rules the tab last knew. On the 200
 * the tab marks what it sent saved; a row the save could not read back is read again, and when
 * that read fails too the page says to reload, the rules it knew kept (ruling 167). Nothing to
 * report: the dialog closes with a toast; else it shows the result until Close.
 */
export function useRulesChangeDialog<S = unknown>(tournamentId: string) {
  const { t } = useI18n();
  const toast = useToast();
  const [refused, setRefused] = useState<RefusedRulesSave<S> | null>(null);
  const [result, setResult] = useState<FollowReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const path = `/api/v1/tournaments/${tournamentId}`;

  /** Opens on a refusal; null closes. Each opening starts with no result and no refusal words. */
  function open(next: RefusedRulesSave<S> | null) {
    setRefused(next);
    setResult(null);
    setError(null);
  }
  const close = () => open(null);

  async function confirm(words: ConfirmWords, host: RulesHost<S>) {
    if (!refused) throw new Error('The rules-change dialog confirmed with no refused save.');
    setBusy(true);
    setError(null);
    const r = await resend(path, refused.body, words, host.stored.expected);
    setBusy(false);
    if (!r.ok) {
      setError(rulesChangeRefusal(r, t) ?? failureMessage(r, t, t('admin.common.saveFailed')));
      return;
    }
    const { tournament, rulesetChange } = r.data;
    host.saved(tournament, refused.sent);
    host.onRulesSaved?.();
    const report = hasReport(rulesetChange);
    if (report) setResult(rulesetChange);
    else close();
    // One message (ruling 167): "Rules saved." once the row is known, else the reload words.
    const readBack = tournament !== null || (await rereadRow(path, host));
    if (!readBack) toast.info(t('admin.rulesChange.reloadToSee'));
    else if (!report) toast.success(t('admin.rulesChange.saved'));
  }

  return { refused, open, result, busy, error, close, confirm };
}

export type RulesChangeDialogState<S = unknown> = ReturnType<typeof useRulesChangeDialog<S>>;
