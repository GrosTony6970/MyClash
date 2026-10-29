'use client';

import { useI18n } from '@myclash/next-i18n/client';
import { Modal } from '@myclash/ui';
import { rulesChangeLines } from '@myclash/types';
import { LineageLamps } from '@/components/rulesets/LineageLamps';
import { ConfirmFields, ConfirmFooter, useConfirmWords, type ConfirmWords } from './RulesConfirm';
import type { RepinPreview } from './useRepinDialog';

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
  onConfirm: (words: ConfirmWords) => void;
  onClose: () => void;
}

/**
 * The audited ruleset re-pin ceremony. Opens when an ordinary ruleset change is
 * refused because the tournament already has fought bouts. It shows what changes
 * (the preview's `changes`, worded by `rulesChangeLines`: the lines the public
 * notice shows too), and asks for a reason (shown publicly) and the tournament's
 * name, typed (`RulesConfirm.tsx`, shared with a settings change). Confirming calls
 * POST /tournaments/:id/repin-ruleset (`useRepinDialog`). The tab mounts it only
 * while a re-pin is asked, so each ask starts with an empty reason and name.
 */
export function RepinRulesetDialog(props: RepinRulesetDialogProps) {
  const { t } = useI18n();
  const fields = useConfirmWords(props.tournamentName);

  return (
    <Modal
      open
      onClose={props.onClose}
      busy={props.busy}
      size="lg"
      title={t('admin.orgTournaments.repinRulesetTitle')}
      footer={
        <ConfirmFooter
          busy={props.busy}
          valid={fields.valid}
          label={t('admin.orgTournaments.repinRulesetConfirm')}
          onConfirm={() => props.onConfirm(fields.words())}
          onClose={props.onClose}
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
          fields={fields}
          placeholder={t('admin.orgTournaments.repinRulesetJustificationPlaceholder')}
          tournamentName={props.tournamentName}
          error={props.error}
        />
      </div>
    </Modal>
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
