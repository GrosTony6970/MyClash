'use client';

import { statusLabel } from '@myclash/ui';
import type { Translator } from '@myclash/next-i18n/client';
import { DraftActionsView } from '@/components/ai/DraftActionsView';
import { partlyApplied, type AssistantDraft } from '@/components/ai/assistant-draft';

interface Props {
  draft: AssistantDraft;
  busy: boolean;
  isReadOnly: boolean;
  onApply: () => void;
  onReject: () => void;
  t: Translator;
}

/**
 * The open draft: its state, its checks, its actions in words (ruling 993) and its Apply and
 * Reject. A draft whose Apply started has neither: an applied one is done, and a partly applied
 * one says so and stays as it is (ruling 997).
 */
export function DraftPanel({ draft, busy, isReadOnly, onApply, onReject, t }: Props) {
  return (
    <div className="mt-6 space-y-4 border-t border-border pt-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display font-semibold text-lg sm:text-xl text-foreground">
            {t('organizer.aiAssistant.preview')}
          </h2>
          <p className="text-sm text-foreground-secondary">{draft.summary}</p>
        </div>
        <span className="rounded-full bg-border px-3 py-1 text-xs font-semibold text-foreground-secondary">
          {statusLabel('aiDraft', draft.status, t)}
        </span>
      </div>

      {draft.validationState.errors?.length ? (
        <div className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          {draft.validationState.errors.join(', ')}
        </div>
      ) : null}

      {draft.validationState.warnings?.length ? (
        <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
          {draft.validationState.warnings.join(', ')}
        </div>
      ) : null}

      <DraftActionsView actions={draft.readable} />

      {partlyApplied(draft) && (
        <p className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
          {t('organizer.aiAssistant.partlyApplied')}
        </p>
      )}

      {!draft.applyStarted && (
        <DraftDecision
          canApply={!busy && draft.status === 'ready' && !isReadOnly}
          canReject={!busy && !isReadOnly}
          onApply={onApply}
          onReject={onReject}
          t={t}
        />
      )}
    </div>
  );
}

function DraftDecision(props: {
  canApply: boolean;
  canReject: boolean;
  onApply: () => void;
  onReject: () => void;
  t: Translator;
}) {
  return (
    <div className="flex flex-wrap gap-3">
      <button
        type="button"
        onClick={props.onApply}
        disabled={!props.canApply}
        className="rounded-lg bg-strong px-4 py-2 text-sm font-semibold text-strong-foreground hover:bg-strong-hover disabled:opacity-50"
      >
        {props.t('actions.apply')}
      </button>
      <button
        type="button"
        onClick={props.onReject}
        disabled={!props.canReject}
        className="rounded-lg px-4 py-2 text-sm font-semibold text-danger hover:bg-danger/10 disabled:opacity-50"
      >
        {props.t('actions.reject')}
      </button>
    </div>
  );
}
