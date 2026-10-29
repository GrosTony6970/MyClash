'use client';

import { useI18n } from '@myclash/next-i18n/client';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { EffectiveRules } from '@myclash/types';
import { useToast } from '@myclash/ui';
import { apiRequest, failureMessage, type ApiFailure } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';
import { needsAuditOf, rulesChangeRefusal, type NeedsAudit } from '@/lib/rules-change-refusal';
import { patchOf } from './patch-of';
import { sameForm, useDirtyReport } from './useSavedSnapshot';

const apiUrl = getPublicApiUrl();

/** The Tournament row as `GET /tournaments/:id` answers it, the rules in force beside it. */
export type RulesRow = Record<string, unknown> & { effectiveRules?: EffectiveRules | null };

export type RulesStatus = 'loading' | 'failed' | 'ready';

/**
 * How a rules screen reads its form from the rules in force, and the PATCH body of a form. A
 * module-level constant: the read runs again when it changes.
 */
export interface RulesFormSpec<F> {
  formOf: (rules: EffectiveRules) => F;
  bodyOf: (form: F) => Record<string, unknown>;
}

/** What a save did: nothing to send, written, or refused (the refusal is already said). */
export type RulesSave = 'none' | 'saved' | 'failed';

/** A save the lock refused (`rules_change_needs_audit`): what it sent, from which form. */
export type RefusedRulesSave<F> = NeedsAudit & { body: Record<string, unknown>; sent: F };

export interface RulesForm<F> {
  status: RulesStatus;
  /** The row read, with the raw columns a save answered on top. Null until the read lands. */
  row: RulesRow | null;
  rules: EffectiveRules | null;
  /** Null until the read lands: a screen shows no form, and no Save, before it (ruling 46). */
  form: F | null;
  setForm: Dispatch<SetStateAction<F | null>>;
  saving: boolean;
  /** Reads the rules again: Retry, and after "Customise this format". */
  reload: () => void;
  /**
   * Sends the leaves changed since the last read or save (`patchOf`), with `extra` (a wizard
   * step's `wizardStep`). Sends nothing, and says so, when nothing changed and there is no extra.
   */
  save: (extra?: Record<string, unknown>) => Promise<RulesSave>;
  /**
   * The last save was refused `rules_change_needs_audit` and no dialog took it: a wizard step,
   * whose change is made from the Tournament's settings (ruling 168).
   */
  needsAudit: boolean;
  /** An audited save landed: what the form sent is saved, the row it read back taken. */
  setSaved: Dispatch<SetStateAction<F | null>>;
  setRow: Dispatch<SetStateAction<RulesRow | null>>;
  /** Which read the state comes from: an answer compares it before and after it lands. */
  generation: () => number;
}

/**
 * The rules screens' ONE read and ONE save (the settings tabs and the wizard steps). The form
 * comes from the rules in force the API answers (`effectiveRules`, operator ruling 46): no screen
 * holds a default of its own. A read that fails, or a Tournament whose rules the engine refuses
 * (`effectiveRules: null`), is `failed`: the screen shows the error and a Retry, no form.
 *
 * Races: a read that answers after a newer one started is dropped. A save marks saved the form
 * it SENT, so an edit made while it was in flight stays unsaved; a save that answers after a
 * re-read started (Retry, "Customise this format") marks nothing, the re-read's form stands. Two
 * organisers saving at once: each sends only what they changed, so neither overwrites a field the
 * other changed, but a list (buttons, pinned penalties, a level chain) is sent whole, so the last
 * writer of a list wins it whole, as the last writer of one field wins it.
 *
 * A save the lock refuses (`rules_change_needs_audit`) goes to `onNeedsAudit`, the settings
 * tab's dialog; with none (a wizard step), `needsAudit` says so. Every other refusal is worded.
 */
export function useEffectiveRules<F>(
  tournamentId: string,
  spec: RulesFormSpec<F>,
  onDirtyChange?: (dirty: boolean) => void,
  onNeedsAudit?: (refused: RefusedRulesSave<F>) => void,
): RulesForm<F> {
  const read = useRulesRead(tournamentId, spec, onDirtyChange);
  const { save, saving, needsAudit } = useRulesSave(tournamentId, spec, read, onNeedsAudit);
  const { status, row, form, setForm, reload, setSaved, setRow, generation } = read;
  return {
    status,
    row,
    rules: row?.effectiveRules ?? null,
    form,
    setForm,
    saving,
    reload,
    save,
    needsAudit,
    setSaved,
    setRow,
    generation,
  };
}

/** The save half: what changed since the read or the last save, and what its refusal means. */
function useRulesSave<F>(
  tournamentId: string,
  spec: RulesFormSpec<F>,
  read: ReturnType<typeof useRulesRead<F>>,
  onNeedsAudit?: (refused: RefusedRulesSave<F>) => void,
) {
  const { t } = useI18n();
  const toast = useToast();
  const { form, saved, setSaved, setRow, generation } = read;
  const [saving, setSaving] = useState(false);
  const [needsAudit, setNeedsAudit] = useState(false);
  const path = `/api/v1/tournaments/${tournamentId}`;

  const save = useCallback(
    async (extra: Record<string, unknown> = {}): Promise<RulesSave> => {
      if (form === null || saved === null) return 'none';
      const changes = patchOf(spec.bodyOf(saved), spec.bodyOf(form));
      if (!changes && Object.keys(extra).length === 0) {
        toast.info(t('admin.orgTournaments.noChangesToSave'));
        return 'none';
      }
      setSaving(true);
      setNeedsAudit(false);
      const readWhenSent = generation();
      const body = { ...changes, ...extra };
      try {
        const r = await apiRequest<RulesRow>(apiUrl, path, { method: 'PATCH', body });
        if (!r.ok) {
          const audit = sayUnlessLocked(r, t, toast);
          if (audit && onNeedsAudit) onNeedsAudit({ ...audit, body, sent: form });
          else if (audit) setNeedsAudit(true);
          return 'failed';
        }
        if (generation() === readWhenSent) {
          setSaved(form);
          setRow((before) => ({ ...before, ...r.data }));
        }
        return 'saved';
      } finally {
        setSaving(false);
      }
    },
    [form, saved, spec, path, t, toast, setSaved, setRow, generation, onNeedsAudit],
  );

  return { save, saving, needsAudit };
}

/**
 * Says a refused save in the reader's words, unless the lock refused it
 * (`rules_change_needs_audit`): that one goes through the audit, and its lists are returned.
 */
function sayUnlessLocked(
  failure: ApiFailure,
  t: (key: string) => string,
  toast: { error: (message: string) => void },
): NeedsAudit | null {
  const audit = needsAuditOf(failure);
  if (!audit) {
    const words =
      rulesChangeRefusal(failure, t) ?? failureMessage(failure, t, t('admin.common.saveFailed'));
    if (words) toast.error(words);
  }
  return audit;
}

/**
 * The read half: the row, the form shown and the form saved, and whether they differ (reported to
 * the page, which asks before an edit is lost). Its mount read starts from `loading`; `reload`
 * (Retry, after "Customise this format") clears the form first, so no form of an older read is
 * shown beside, or saved against, this one's answer.
 */
function useRulesRead<F>(
  tournamentId: string,
  spec: RulesFormSpec<F>,
  onDirtyChange?: (dirty: boolean) => void,
) {
  const [status, setStatus] = useState<RulesStatus>('loading');
  const [row, setRow] = useState<RulesRow | null>(null);
  const [form, setForm] = useState<F | null>(null);
  const [saved, setSaved] = useState<F | null>(null);
  const latestRead = useRef(0);
  useDirtyReport(
    form !== null && saved !== null && !sameForm(spec.bodyOf(form), spec.bodyOf(saved)),
    onDirtyChange,
  );

  const read = useCallback(() => {
    const read = ++latestRead.current;
    void apiRequest<RulesRow>(apiUrl, `/api/v1/tournaments/${tournamentId}`).then((r) => {
      if (read !== latestRead.current) return;
      const rules = r.ok ? r.data.effectiveRules : null;
      if (!r.ok || !rules) {
        setStatus('failed');
        return;
      }
      const shown = spec.formOf(rules);
      setRow(r.data);
      setForm(shown);
      setSaved(shown);
      setStatus('ready');
    });
  }, [tournamentId, spec]);

  useEffect(() => {
    read();
  }, [read]);

  const reload = useCallback(() => {
    setStatus('loading');
    setForm(null);
    setSaved(null);
    read();
  }, [read]);

  /** Which read the state comes from: a save compares it before and after it is answered. */
  const generation = useCallback(() => latestRead.current, []);

  return { status, row, setRow, form, setForm, saved, setSaved, reload, generation };
}
