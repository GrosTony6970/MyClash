'use client';

/**
 * The assign-a-referee modal, shared by every screen that renders slot cards.
 *
 * Three groups, from the one referee checker's verdict (ADR-016), which the server
 * computes for every candidate of the slot:
 *   - Recommended: nothing against them.
 *   - Needs confirmation (Discouraged): the reasons are shown, and "Assign anyway"
 *     sends the confirmation — the organiser has read them.
 *   - Not possible (Impossible, or no skill this slot allows): shown, never pickable.
 * The same call answers the Assign button, so the picker and Assign cannot disagree.
 */

import { useI18n } from '@myclash/next-i18n/client';
import { Modal } from '@myclash/ui';
import { refereeReasonsText, type PickerReason } from '@/lib/referee-reasons';
import type {
  AssignmentBoardPool,
  AssignmentBoardRoleSlot,
  PickerCandidate,
} from './useAssignmentBoard';

export function CandidatePicker({
  pool,
  slot,
  slotLabel,
  onAssign,
  onCancel,
}: {
  pool: Pick<AssignmentBoardPool, 'name' | 'tournamentName'>;
  slot: AssignmentBoardRoleSlot;
  /** The slot's name as the screen shows it; the slot's own display name by default. */
  slotLabel?: string;
  /** `confirm` is true for a candidate picked from "Needs confirmation". */
  onAssign: (personId: string, confirm: boolean) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();

  return (
    <Modal
      open
      onClose={onCancel}
      size="lg"
      title={`${pool.name} - ${slotLabel ?? slot.displayName ?? slot.role}`}
      description={pool.tournamentName}
      footer={
        <button
          type="button"
          onClick={onCancel}
          className="text-sm text-muted hover:text-foreground"
        >
          {t('organizer.refereeBoard.cancel')}
        </button>
      }
    >
      <div className="max-h-96 space-y-3 overflow-y-auto">
        <CandidateGroup
          title={t('organizer.refereeBoard.pickerRecommended')}
          candidates={slot.candidates.recommended}
          action={t('organizer.refereeBoard.pick')}
          tone="recommended"
          onSelect={(candidate) => onAssign(candidate.personId, false)}
        />
        <CandidateGroup
          title={t('organizer.refereeBoard.pickerDiscouraged')}
          candidates={slot.candidates.warning}
          action={t('organizer.refereeBoard.pickAnyway')}
          tone="discouraged"
          onSelect={(candidate) => onAssign(candidate.personId, true)}
        />
        <CandidateGroup
          title={t('organizer.refereeBoard.pickerBlocked')}
          candidates={slot.candidates.blocked}
          tone="impossible"
        />
      </div>
    </Modal>
  );
}

const TONES = {
  recommended: { reasons: '', button: 'border-success text-success hover:bg-success/10' },
  discouraged: {
    reasons: 'text-warning',
    button: 'border-warning text-warning hover:bg-warning/10',
  },
  impossible: { reasons: 'text-danger', button: '' },
} as const;

function CandidateGroup({
  title,
  candidates,
  action,
  tone,
  onSelect,
}: {
  title: string;
  candidates: Array<PickerCandidate & { reasons?: PickerReason[] }>;
  /** The button's words; no button when absent (the candidate cannot be picked). */
  action?: string;
  tone: keyof typeof TONES;
  onSelect?: (candidate: PickerCandidate) => void;
}) {
  if (candidates.length === 0) return null;
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">
        {title} ({candidates.length})
      </p>
      <ul className="space-y-1">
        {candidates.map((candidate) => (
          <li
            key={candidate.personId}
            className={[
              'flex items-center justify-between gap-3 rounded border px-3 py-1.5 text-sm',
              action ? 'border-border bg-surface' : 'border-border bg-background text-muted',
            ].join(' ')}
          >
            <CandidateLine candidate={candidate} reasonsClass={TONES[tone].reasons} />
            {action && onSelect && (
              <button
                type="button"
                onClick={() => onSelect(candidate)}
                className={`shrink-0 rounded border px-2 py-0.5 text-xs font-semibold ${TONES[tone].button}`}
              >
                {action}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Who the candidate is, and the checker's reasons against them in the group's colour. */
function CandidateLine({
  candidate,
  reasonsClass,
}: {
  candidate: PickerCandidate & { reasons?: PickerReason[] };
  reasonsClass: string;
}) {
  const { t } = useI18n();
  return (
    <div className="min-w-0">
      <p className="truncate font-medium text-foreground">{candidate.displayName}</p>
      {candidate.clubLabel && (
        <p className="truncate text-[10px] text-muted">{candidate.clubLabel}</p>
      )}
      {candidate.boutsThatDay !== null && (
        <p className="text-[10px] text-muted">
          {t('organizer.refereeBoard.pickerBoutsThatDay', {
            count: String(candidate.boutsThatDay),
          })}
        </p>
      )}
      {candidate.reasons && candidate.reasons.length > 0 && (
        <p className={`text-[10px] ${reasonsClass}`}>{refereeReasonsText(t, candidate.reasons)}</p>
      )}
    </div>
  );
}
