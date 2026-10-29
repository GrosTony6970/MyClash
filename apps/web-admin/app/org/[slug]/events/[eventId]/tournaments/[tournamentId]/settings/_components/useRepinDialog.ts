'use client';

import { useCallback, useRef, useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import { apiRequest, failureMessage, type ApiFailure } from '@myclash/api-client';
import type { BucketDiff } from '@myclash/rulesets';
import type { RulesChange, RulesExpected } from '@myclash/types';
import type { ForfeitChanges } from '@myclash/types/forfeit-rules';
import { getPublicApiUrl } from '@/lib/api-url';
import { rulesChangeRefusal } from '@/lib/rules-change-refusal';

const apiUrl = getPublicApiUrl();

/** A ruleset and the version of it a Tournament is pinned to. */
export interface RulesetPair {
  code: string;
  version: string;
}

/** What the re-pin preview answers: the lamps, and the changes the audit row will record. */
export interface RepinPreview {
  fromCode: string;
  toCode: string;
  diff: BucketDiff;
  changes: RulesChange[];
}

/** The Tournament's stored name and its rules as its row holds them: what a re-pin sends back. */
export interface StoredRules {
  name: string;
  expected: RulesExpected;
}

/**
 * The stored name and the RAW rules of a Tournament row (`GET /tournaments/:id`, a PATCH's answer,
 * a re-pin's `tournament`): never normalized, never defaulted, so the server's compare with the
 * row it locks sees exactly what this screen read. A column the row lacks is null.
 */
export function storedRulesOf(row: Record<string, unknown>): StoredRules {
  const raw = <T>(column: string) => (row[column] ?? null) as T | null;
  return {
    name: (row['name'] as string | undefined) ?? '',
    expected: {
      rulesetCode: raw<string>('ruleset_code'),
      rulesetVersion: raw<string>('ruleset_version'),
      rulesetConfig: raw<Record<string, unknown>>('ruleset_config'),
      scoringConfig: raw<Record<string, unknown>>('scoring_config_json'),
      penaltyRulesetId: raw<string>('penalty_ruleset_id'),
      penaltyRulesetVersion: raw<string>('penalty_ruleset_version'),
      forfeitRules: raw<ForfeitChanges>('forfeit_rules'),
    },
  };
}

function previewPath(tournamentId: string, to: RulesetPair): string {
  const query = `rulesetCode=${encodeURIComponent(to.code)}&rulesetVersion=${encodeURIComponent(to.version)}`;
  return `/api/v1/tournaments/${tournamentId}/repin-preview?${query}`;
}

/** The re-pin itself: the typed name and the rules the screen last knew ride with the reason. */
function postRepin(
  tournamentId: string,
  to: RulesetPair,
  expected: RulesExpected,
  words: { justification: string; typedName: string },
) {
  return apiRequest<{ tournament: Record<string, unknown> }>(
    apiUrl,
    `/api/v1/tournaments/${tournamentId}/repin-ruleset`,
    {
      method: 'POST',
      body: {
        rulesetCode: to.code,
        rulesetVersion: to.version,
        justification: words.justification,
        confirm: words.typedName,
        expected,
      },
    },
  );
}

/**
 * The re-pin preview of one target. The race handled: an answer that lands after the dialog
 * closed, or reopened on another ruleset, is dropped (`asked`).
 */
function useRepinPreview(tournamentId: string, wordsOf: RefusalWords) {
  const { t } = useI18n();
  const [preview, setPreview] = useState<RepinPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const asked = useRef(0);

  async function load(to: RulesetPair) {
    const ask = ++asked.current;
    const r = await apiRequest<RepinPreview>(apiUrl, previewPath(tournamentId, to));
    if (ask !== asked.current) return;
    if (r.ok) setPreview(r.data);
    else setPreviewError(wordsOf(r, t('admin.rulesChange.previewFailed')));
  }

  function clear() {
    asked.current++;
    setPreview(null);
    setPreviewError(null);
  }

  return { preview, previewError, load, clear };
}

/** A refusal in words, or the request's own fallback. */
type RefusalWords = (failure: ApiFailure, fallback: string) => string | null;

interface RepinDialogOptions {
  tournamentId: string;
  /**
   * The screen's own words for a refusal that carries no rules-change code, or null for the
   * request's own words. Asked of the preview and the confirm alike: one gate, one sentence.
   */
  otherRefusal: (failure: ApiFailure) => string | null;
  onRepinned: (to: RulesetPair) => void;
}

/**
 * The audited re-pin of a Tournament's ruleset: the dialog's state, its preview and its POST.
 * `remember` takes the stored rules of every row the tab reads or saves, so `expected` is always
 * the screen's last known row. A refusal with a rules-change code is worded here; any other is
 * the caller's to word (`otherRefusal`). Two re-pins on one stale read are the server's: the
 * second gets `rules_changed_since_read`, worded with the reload words.
 */
export function useRepinDialog({ tournamentId, otherRefusal, onRepinned }: RepinDialogOptions) {
  const { t } = useI18n();
  const wordsOf: RefusalWords = (r, fallback) =>
    rulesChangeRefusal(r, t) ?? otherRefusal(r) ?? failureMessage(r, t, fallback);
  const remembered = useRemembered();
  const { stored, remember } = remembered;
  const [target, setTarget] = useState<RulesetPair | null>(null);
  const { preview, previewError, load, clear } = useRepinPreview(tournamentId, wordsOf);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open(to: RulesetPair) {
    setTarget(to);
    await load(to);
  }

  /** Also what a later open starts from: no preview, no refusal. */
  function close() {
    clear();
    setTarget(null);
    setError(null);
  }

  async function confirm(words: { justification: string; typedName: string }) {
    if (!target || !stored) return;
    setBusy(true);
    setError(null);
    // `apiRequest` answers every failure as a value; it does not throw.
    const r = await postRepin(tournamentId, target, stored.expected, words);
    setBusy(false);
    if (!r.ok) {
      setError(wordsOf(r, t('admin.common.saveFailed')));
      return;
    }
    remember(storedRulesOf(r.data.tournament));
    close();
    onRepinned(target);
  }

  return { ...remembered, target, preview, previewError, busy, error, open, close, confirm };
}

/**
 * The stored rules the tab last knew, and how many times it was told: a read sent before a later
 * `remember` is dropped when it lands (`stamp`; Pass 6 item 3). ONE identity for `remember`: the
 * tab's loader effect depends on it, and web-admin has no React Compiler.
 */
function useRemembered() {
  const [stored, setStored] = useState<StoredRules | null>(null);
  const told = useRef(0);
  const remember = useCallback((next: StoredRules) => {
    told.current++;
    setStored(next);
  }, []);
  const stamp = useCallback(() => told.current, []);
  return { stored, remember, stamp };
}
