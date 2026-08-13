'use client';

import { useI18n } from '@myclash/next-i18n/client';
import { useState } from 'react';
import { Modal } from '@myclash/ui';
import type { BucketDiff } from '@myclash/rulesets';
import { LineageLamps } from '@/components/rulesets/LineageLamps';

/** The backend requires a justification of at least this many characters; the
 *  confirm button stays disabled until the reason is real (the typed
 *  confirmation gate). */
const MIN_JUSTIFICATION = 10;

/**
 * The mid-event ruleset re-pin ceremony. Opens when an ordinary ruleset change
 * is refused because the tournament already has scored matches: re-pinning
 * re-ranks those results, so it demands a typed, mandatory justification (shown
 * publicly) before it is allowed. Confirming calls POST
 * /tournaments/:id/repin-ruleset.
 */
export function RepinRulesetDialog({
  open,
  fromLabel,
  toLabel,
  diff,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  open: boolean;
  fromLabel: string;
  toLabel: string;
  /** Computed per-bucket lineage diff of the new ruleset vs the pinned one, so
   *  the organiser sees WHICH buckets change before confirming. Null while the
   *  preview loads (or if it fails — the ceremony still works without it). */
  diff: BucketDiff | null;
  busy: boolean;
  error: string | null;
  onConfirm: (justification: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();

  const [justification, setJustification] = useState('');
  const valid = justification.trim().length >= MIN_JUSTIFICATION;

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={busy}
      size="lg"
      title={t('admin.orgTournaments.repinRulesetTitle')}
      footer={
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
            onClick={() => onConfirm(justification.trim())}
            disabled={busy || !valid}
            className="rounded-md bg-danger px-4 py-2 text-sm font-semibold text-danger-foreground hover:bg-danger-hover disabled:opacity-50"
          >
            {busy ? t('common.saving') : t('admin.orgTournaments.repinRulesetConfirm')}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          {t('admin.orgTournaments.repinRulesetWarning')}
        </p>
        <p className="text-sm text-foreground-secondary">
          {t('admin.orgTournaments.repinRulesetFromTo', { from: fromLabel, to: toLabel })}
        </p>
        {diff && (
          <div className="rounded-md border border-border bg-surface p-4">
            <LineageLamps base={fromLabel} diff={diff} />
          </div>
        )}
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-foreground-secondary">
            {t('admin.orgTournaments.repinRulesetJustificationLabel')}
          </span>
          <textarea
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            rows={3}
            placeholder={t('admin.orgTournaments.repinRulesetJustificationPlaceholder')}
            className="w-full rounded-md border border-border px-3 py-2 text-sm"
          />
        </label>
        {error ? (
          <p className="rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
