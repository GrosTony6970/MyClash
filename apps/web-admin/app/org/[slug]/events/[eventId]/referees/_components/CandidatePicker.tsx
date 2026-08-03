'use client';

/**
 * The assign-a-referee modal, shared by every tab that renders slot cards.
 *
 * Was duplicated verbatim in the pools and bracket tabs, with one real
 * difference: pools also greys out anyone already refereeing a CONCURRENT pool.
 * That is expressed here as an optional `busyUserIds` set — passing none
 * reproduces the bracket tab's behaviour exactly, so one component covers both
 * rather than the difference justifying two copies.
 */

import { useMemo } from 'react';
import { t } from '@myclash/i18n';
import { Modal } from '@myclash/ui';
import type {
  AssignmentBoardCandidate,
  AssignmentBoardPool,
  AssignmentBoardRoleSlot,
} from './useAssignmentBoard';

export function CandidatePicker({
  pool,
  slot,
  busyUserIds,
  onAssign,
  onCancel,
}: {
  pool: Pick<AssignmentBoardPool, 'name' | 'tournamentName'>;
  slot: AssignmentBoardRoleSlot;
  /**
   * Referees unavailable for a reason the engine cannot see from this unit
   * alone — currently "already on a pool running at the same time". They are
   * demoted from recommended into blocked rather than hidden, so the operator
   * learns why someone who looks available is not.
   */
  busyUserIds?: Set<string>;
  onAssign: (userId: string) => void;
  onCancel: () => void;
}) {
  const busy = busyUserIds ?? EMPTY;

  const blocked = useMemo(() => {
    const fromBlocked = slot.candidates.blocked.map((candidate) => ({
      ...candidate,
      reasons: busy.has(candidate.userId)
        ? [...candidate.reasons, 'busy_in_concurrent_pool']
        : candidate.reasons,
    }));
    const promoted = slot.candidates.recommended
      .filter((candidate) => busy.has(candidate.userId))
      .map((candidate) => ({ ...candidate, reasons: ['busy_in_concurrent_pool'] }));
    return [...promoted, ...fromBlocked];
  }, [slot, busy]);

  const recommended = useMemo(
    () => slot.candidates.recommended.filter((candidate) => !busy.has(candidate.userId)),
    [slot, busy],
  );

  return (
    <Modal
      open
      onClose={onCancel}
      size="lg"
      title={`${pool.name} - ${slot.displayName ?? slot.role}`}
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
          candidates={recommended}
          onSelect={(candidate) => onAssign(candidate.userId)}
        />
        <CandidateGroup
          title={t('organizer.refereeBoard.pickerBlocked')}
          candidates={blocked.map((candidate) => ({
            ...candidate,
            blockedReasons: candidate.reasons,
          }))}
          disabled
        />
      </div>
    </Modal>
  );
}

const EMPTY: Set<string> = new Set();

function CandidateGroup({
  title,
  candidates,
  onSelect,
  disabled = false,
}: {
  title: string;
  candidates: Array<AssignmentBoardCandidate & { blockedReasons?: string[] }>;
  onSelect?: (candidate: AssignmentBoardCandidate) => void;
  disabled?: boolean;
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
            key={candidate.userId}
            className={[
              'flex items-center justify-between gap-3 rounded border px-3 py-1.5 text-sm',
              disabled
                ? 'border-border bg-background text-muted'
                : 'border-border bg-surface hover:border-border',
            ].join(' ')}
          >
            <div className="min-w-0">
              <p className="truncate font-medium text-foreground">{candidate.displayName}</p>
              {candidate.clubLabel && (
                <p className="truncate text-[10px] text-muted">{candidate.clubLabel}</p>
              )}
              {candidate.blockedReasons && (
                <p className="text-[10px] text-danger">{candidate.blockedReasons.join(', ')}</p>
              )}
            </div>
            {!disabled && onSelect && (
              <button
                type="button"
                onClick={() => onSelect(candidate)}
                className="rounded border border-success px-2 py-0.5 text-xs font-semibold text-success hover:bg-success/10"
              >
                {t('organizer.refereeBoard.pick')}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
