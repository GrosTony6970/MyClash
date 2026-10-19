'use client';

import { useI18n } from '@myclash/next-i18n/client';
import { useState } from 'react';
import { Modal } from '@myclash/ui';
import { rulesChangeLines, sameTournamentName } from '@myclash/types';
import { LineageLamps } from '@/components/rulesets/LineageLamps';
import type { RepinPreview } from './useRepinDialog';

/** The backend requires a justification of at least this many characters; the
 *  confirm button stays disabled until the reason is real. */
const MIN_JUSTIFICATION = 10;

const FIELD = 'w-full rounded-md border border-border px-3 py-2 text-sm';
const LABEL = 'mb-1 block text-xs font-medium text-foreground-secondary';

interface RepinRulesetDialogProps {
  fromLabel: string;
  toLabel: string;
  /** The name the server holds, not the Basics field's unsaved edit. */
  tournamentName: string;
  /** Null while the preview loads, or when it failed (`previewError` then says why). */
  preview: RepinPreview | null;
  previewError: string | null;
  busy: boolean;
  error: string | null;
  onConfirm: (words: { justification: string; typedName: string }) => void;
  onClose: () => void;
}

/**
 * The audited ruleset re-pin ceremony. Opens when an ordinary ruleset change is
 * refused because the tournament already has fought bouts. It shows what changes
 * (the preview's `changes`, worded by `rulesChangeLines`: the lines the public
 * notice shows too), and asks for a reason (shown publicly) and the tournament's
 * name, typed. The confirm button opens only when the typed name is the stored
 * one by `sameTournamentName`, the server's own test. Confirming calls POST
 * /tournaments/:id/repin-ruleset (`useRepinDialog`). The tab mounts it only while
 * a re-pin is asked, so each ask starts with an empty reason and name.
 */
export function RepinRulesetDialog(props: RepinRulesetDialogProps) {
  const { t } = useI18n();
  const [justification, setJustification] = useState('');
  const [typedName, setTypedName] = useState('');
  const valid =
    justification.trim().length >= MIN_JUSTIFICATION &&
    sameTournamentName(typedName, props.tournamentName);

  return (
    <Modal
      open
      onClose={props.onClose}
      busy={props.busy}
      size="lg"
      title={t('admin.orgTournaments.repinRulesetTitle')}
      footer={
        <RepinFooter
          {...props}
          valid={valid}
          onConfirm={() => props.onConfirm({ justification: justification.trim(), typedName })}
        />
      }
    >
      <div className="space-y-4">
        <p className="rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          {t('admin.orgTournaments.repinRulesetWarning')}
        </p>
        <p className="text-sm text-foreground-secondary">
          {t('admin.orgTournaments.repinRulesetFromTo', {
            from: props.fromLabel,
            to: props.toLabel,
          })}
        </p>
        <RepinChanges {...props} />
        <ConfirmFields
          justification={justification}
          setJustification={setJustification}
          typedName={typedName}
          setTypedName={setTypedName}
          tournamentName={props.tournamentName}
          error={props.error}
        />
      </div>
    </Modal>
  );
}

/** The reason, the typed name, and why the last confirm was refused. */
function ConfirmFields(p: {
  justification: string;
  setJustification: (value: string) => void;
  typedName: string;
  setTypedName: (value: string) => void;
  tournamentName: string;
  error: string | null;
}) {
  const { t } = useI18n();
  return (
    <>
      <label className="block">
        <span className={LABEL}>{t('admin.orgTournaments.repinRulesetJustificationLabel')}</span>
        <textarea
          value={p.justification}
          onChange={(e) => p.setJustification(e.target.value)}
          rows={3}
          placeholder={t('admin.orgTournaments.repinRulesetJustificationPlaceholder')}
          className={FIELD}
        />
      </label>
      <label className="block">
        <span className={LABEL}>
          {t('admin.rulesChange.typeNameLabel', { name: p.tournamentName })}
        </span>
        <input
          value={p.typedName}
          onChange={(e) => p.setTypedName(e.target.value)}
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

function RepinFooter({
  busy,
  valid,
  onConfirm,
  onClose,
}: {
  busy: boolean;
  valid: boolean;
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
        {busy ? t('common.saving') : t('admin.orgTournaments.repinRulesetConfirm')}
      </button>
    </>
  );
}

/** What the re-pin changes: one line per changed setting, then the lineage lamps. */
function RepinChanges({
  fromLabel,
  preview,
  previewError,
}: {
  fromLabel: string;
  preview: RepinPreview | null;
  previewError: string | null;
}) {
  const { t } = useI18n();
  if (previewError) return <p className="text-sm text-danger">{previewError}</p>;
  if (!preview) return <p className="text-sm text-muted">{t('common.loading')}</p>;
  const lines = rulesChangeLines(preview.changes, t);
  return (
    <div className="space-y-3 rounded-md border border-border bg-surface p-4">
      <h3 className="text-xs font-medium text-foreground-secondary">
        {t('admin.rulesChange.changesHeading')}
      </h3>
      {lines.length === 0 ? (
        <p className="text-sm text-foreground">{t('admin.rulesChange.noScoringChange')}</p>
      ) : (
        <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      <LineageLamps base={fromLabel} diff={preview.diff} />
    </div>
  );
}
