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
import { apiRequest, failureMessage } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';
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
 */
export function useEffectiveRules<F>(
  tournamentId: string,
  spec: RulesFormSpec<F>,
  onDirtyChange?: (dirty: boolean) => void,
): RulesForm<F> {
  const { t } = useI18n();
  const toast = useToast();
  const read = useRulesRead(tournamentId, spec, onDirtyChange);
  const { form, saved, setSaved, setRow, generation } = read;
  const [saving, setSaving] = useState(false);

  const save = useCallback(
    async (extra: Record<string, unknown> = {}): Promise<RulesSave> => {
      if (form === null || saved === null) return 'none';
      const changes = patchOf(spec.bodyOf(saved), spec.bodyOf(form));
      if (!changes && Object.keys(extra).length === 0) {
        toast.info(t('admin.orgTournaments.noChangesToSave'));
        return 'none';
      }
      setSaving(true);
      const readWhenSent = generation();
      try {
        const r = await apiRequest<Record<string, unknown>>(
          apiUrl,
          `/api/v1/tournaments/${tournamentId}`,
          { method: 'PATCH', body: { ...changes, ...extra } },
        );
        if (!r.ok) {
          const message = failureMessage(r, t, t('admin.common.saveFailed'));
          if (message) toast.error(message);
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
    [form, saved, spec, tournamentId, t, toast, setSaved, setRow, generation],
  );

  const { status, row, setForm, reload } = read;
  return { status, row, rules: row?.effectiveRules ?? null, form, setForm, saving, reload, save };
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
