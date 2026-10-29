'use client';

import { useI18n } from '@myclash/next-i18n/client';
import { useState } from 'react';
import { sameTournamentName } from '@myclash/types';

/** The backend requires a justification of at least this many characters; the
 *  confirm button stays disabled until the reason is real. */
const MIN_JUSTIFICATION = 10;

const FIELD = 'w-full rounded-md border border-border px-3 py-2 text-sm';
const LABEL = 'mb-1 block text-xs font-medium text-foreground-secondary';

/** What a confirmed change sends: the reason, trimmed, and the name as typed. */
export interface ConfirmWords {
  justification: string;
  typedName: string;
}

/**
 * The reason and the typed name of an audited rules change (the re-pin and a settings change
 * share them). Valid once the reason is 10 characters or more and the typed name is the stored
 * one by `sameTournamentName`, the server's own test. A dialog mounted per ask starts empty.
 */
export function useConfirmWords(tournamentName: string) {
  const [justification, setJustification] = useState('');
  const [typedName, setTypedName] = useState('');
  const valid =
    justification.trim().length >= MIN_JUSTIFICATION &&
    sameTournamentName(typedName, tournamentName);
  const words = (): ConfirmWords => ({ justification: justification.trim(), typedName });
  return { justification, setJustification, typedName, setTypedName, valid, words };
}

/** The reason, the typed name, and why the last confirm was refused. */
export function ConfirmFields(p: {
  fields: ReturnType<typeof useConfirmWords>;
  placeholder: string;
  tournamentName: string;
  error: string | null;
}) {
  const { t } = useI18n();
  return (
    <>
      <label className="block">
        <span className={LABEL}>{t('admin.orgTournaments.repinRulesetJustificationLabel')}</span>
        <textarea
          value={p.fields.justification}
          onChange={(e) => p.fields.setJustification(e.target.value)}
          rows={3}
          placeholder={p.placeholder}
          className={FIELD}
        />
      </label>
      <label className="block">
        <span className={LABEL}>
          {t('admin.rulesChange.typeNameLabel', { name: p.tournamentName })}
        </span>
        <input
          value={p.fields.typedName}
          onChange={(e) => p.fields.setTypedName(e.target.value)}
          autoComplete="off"
          className={FIELD}
        />
      </label>
      {p.error ? (
        <p className="rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {p.error}
        </p>
      ) : null}
    </>
  );
}

/** Cancel, and the confirm, closed until the words are valid and while the send is out. */
export function ConfirmFooter({
  busy,
  valid,
  label,
  onConfirm,
  onClose,
}: {
  busy: boolean;
  valid: boolean;
  label: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <>
      <button
        type="button"
        onClick={onClose}
        disabled={busy}
        className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-background disabled:opacity-50"
      >
        {t('common.cancel')}
      </button>
      <button
        type="button"
        onClick={onConfirm}
        disabled={busy || !valid}
        className="rounded-md bg-danger px-4 py-2 text-sm font-semibold text-danger-foreground hover:bg-danger-hover disabled:opacity-50"
      >
        {busy ? t('common.saving') : label}
      </button>
    </>
  );
}
