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

import { useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import { Modal, nameOrUnknown } from '@myclash/ui';
import { PageAlert, errorOutcome } from '@/components/PageAlert';
import { refereeReasonsText, type PickerReason } from '@/lib/referee-reasons';
import { slotRoleName } from '@/lib/referee-role-name';
import { filterCandidates } from './candidate-filter';
import type {
  AssignmentBoardPool,
  AssignmentBoardRoleSlot,
  PickerCandidate,
} from './useAssignmentBoard';

export function CandidatePicker({
  pool,
  slot,
  skillNameById,
  refusal,
  busy,
  onAssign,
  onCancel,
}: {
  pool: Pick<AssignmentBoardPool, 'name' | 'tournamentName'>;
  slot: AssignmentBoardRoleSlot;
  /** The Event's names of its referee skills: the slot is named by `slotRoleName`. */
  skillNameById: ReadonlyMap<string, string>;
  /** Why the last pick was refused, shown in the picker itself (O8). */
  refusal: string | null;
  /** An assignment is out: nothing can be picked. */
  busy: boolean;
  /** `confirm` is true for a candidate picked from "Needs confirmation". */
  onAssign: (personId: string, confirm: boolean) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');

  return (
    <Modal
      open
      onClose={onCancel}
      busy={busy}
      size="lg"
      title={`${pool.name} - ${slotRoleName(slot, t, skillNameById)}`}
      description={pool.tournamentName}
      footer={
        <button
          type="button"
          onClick={onCancel}
          // Closed while an assignment is out: its refusal would show nowhere.
          disabled={busy}
          className="text-sm text-muted hover:text-foreground disabled:opacity-50"
        >
          {t('organizer.refereeBoard.cancel')}
        </button>
      }
    >
      <PageAlert outcome={refusal ? errorOutcome(refusal) : null} className="mb-3" />
      <PickerSearch query={query} onChange={setQuery} />
      <CandidateGroups candidates={slot.candidates} query={query} busy={busy} onAssign={onAssign} />
    </Modal>
  );
}

/** The search field, focused when the picker opens: it opens to find one name (O9). */
function PickerSearch({ query, onChange }: { query: string; onChange: (query: string) => void }) {
  const { t } = useI18n();
  return (
    <input
      type="search"
      // eslint-disable-next-line jsx-a11y/no-autofocus -- the picker opens to find one name
      autoFocus
      value={query}
      onChange={(event) => onChange(event.target.value)}
      aria-label={t('organizer.refereeBoard.pickerSearch')}
      placeholder={t('organizer.refereeBoard.pickerSearch')}
      className="mb-3 w-full rounded-lg border border-border px-3 py-2 text-sm"
    />
  );
}

/** The three groups, each holding only the candidates the search keeps (O9). */
function CandidateGroups({
  candidates,
  query,
  busy,
  onAssign,
}: {
  candidates: AssignmentBoardRoleSlot['candidates'];
  query: string;
  busy: boolean;
  onAssign: (personId: string, confirm: boolean) => void;
}) {
  const { t } = useI18n();
  const recommended = filterCandidates(candidates.recommended, query);
  const warning = filterCandidates(candidates.warning, query);
  const blocked = filterCandidates(candidates.blocked, query);
  const none = recommended.length + warning.length + blocked.length === 0;
  return (
    <div className="max-h-96 space-y-3 overflow-y-auto">
      {none && query.trim() && (
        <p className="text-sm text-muted">
          {t('organizer.refereeBoard.pickerNoMatch', { query: query.trim() })}
        </p>
      )}
      <CandidateGroup
        title={t('organizer.refereeBoard.pickerRecommended')}
        candidates={recommended}
        action={t('organizer.refereeBoard.pick')}
        tone="recommended"
        busy={busy}
        onSelect={(candidate) => onAssign(candidate.personId, false)}
      />
      <CandidateGroup
        title={t('organizer.refereeBoard.pickerDiscouraged')}
        candidates={warning}
        action={t('organizer.refereeBoard.pickAnyway')}
        tone="discouraged"
        busy={busy}
        onSelect={(candidate) => onAssign(candidate.personId, true)}
      />
      <CandidateGroup
        title={t('organizer.refereeBoard.pickerBlocked')}
        candidates={blocked}
        tone="impossible"
      />
    </div>
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
  busy = false,
  onSelect,
}: {
  title: string;
  candidates: Array<PickerCandidate & { reasons?: PickerReason[] }>;
  /** The button's words; no button when absent (the candidate cannot be picked). */
  action?: string;
  tone: keyof typeof TONES;
  busy?: boolean;
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
                disabled={busy}
                onClick={() => onSelect(candidate)}
                className={`shrink-0 rounded border px-2 py-0.5 text-xs font-semibold disabled:opacity-50 ${TONES[tone].button}`}
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
      <p className="truncate font-medium text-foreground">
        {nameOrUnknown(candidate.displayName, 'referee', t)}
      </p>
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
