'use client';

import { DraftActionsView } from '@/components/ai/DraftActionsView';
import { partlyApplied, type AssistantDraft } from '@/components/ai/assistant-draft';

/** A chat proposal is the assistant's draft answer (call U): the card reads these of it. */
export type ChatProposal = Pick<
  AssistantDraft,
  'id' | 'draftType' | 'status' | 'summary' | 'readable' | 'validationState' | 'applyStarted'
>;

interface Props {
  proposal: ChatProposal;
  busy: boolean;
  onConfirm: () => void;
  onReject: () => void;
  t: (key: string) => string;
}

export function ProposalCard({ proposal, busy, onConfirm, onReject, t }: Props) {
  const errors = proposal.validationState.errors ?? [];
  const warnings = proposal.validationState.warnings ?? [];
  const resolved = proposal.status === 'applied' || proposal.status === 'rejected';

  return (
    <div className="mt-2 rounded-lg border border-accent/40 bg-accent/5 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-accent">
          {t('organizer.chat.proposal.title')}
        </span>
        <span className="rounded-full bg-border px-2 py-0.5 text-[11px] font-semibold text-foreground-secondary">
          {t(`organizer.aiAssistant.types.${proposal.draftType}`)}
        </span>
      </div>

      {proposal.summary && <p className="mt-2 text-sm text-foreground">{proposal.summary}</p>}

      <div className="mt-2">
        <DraftActionsView actions={proposal.readable} />
      </div>

      {errors.length > 0 && (
        <p className="mt-2 rounded border border-danger/30 bg-danger/10 px-2 py-1 text-xs text-danger">
          {errors.join(', ')}
        </p>
      )}
      {warnings.length > 0 && (
        <p className="mt-2 rounded border border-warning/30 bg-warning/10 px-2 py-1 text-xs text-warning">
          {warnings.join(', ')}
        </p>
      )}

      {proposal.status === 'applied' && (
        <p className="mt-2 text-xs font-semibold text-success">
          {t('organizer.chat.proposal.applied')}
        </p>
      )}
      {proposal.status === 'rejected' && (
        <p className="mt-2 text-xs font-semibold text-muted">
          {t('organizer.chat.proposal.rejected')}
        </p>
      )}
      {proposal.status === 'failed' && (
        <p className="mt-2 text-xs text-danger">
          {partlyApplied(proposal)
            ? t('organizer.aiAssistant.partlyApplied')
            : t('organizer.chat.proposal.failed')}
        </p>
      )}

      {!resolved && proposal.status === 'ready' && (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="rounded-lg bg-strong px-3 py-1.5 text-xs font-semibold text-strong-foreground hover:bg-strong-hover disabled:opacity-50"
          >
            {t('organizer.chat.proposal.confirm')}
          </button>
          <button
            type="button"
            onClick={onReject}
            disabled={busy}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-danger hover:bg-danger/10 disabled:opacity-50"
          >
            {t('organizer.chat.proposal.reject')}
          </button>
        </div>
      )}
    </div>
  );
}
