'use client';

/**
 * PoolSlotCard — one pool/bracket match as an assignment card: header
 * (tournament – pool, time, optional lice), one coloured band per role
 * slot (assign / unassign), then the member list.
 *
 * Extracted from the pools RefereesTab so the event-level Assignments
 * tab's timeslot grid can render the same card. Structurally typed and
 * generic over the slot type: each tab's own (richer) board types flow
 * through `onAssignClick` unchanged.
 */

import { t } from '@myclash/i18n';
import { localeToBcp47, type AppLocale } from '@myclash/time';
import { useI18n } from '../../../../../../../src/i18n/I18nProvider';
import { assignmentChipClasses } from './assignment-chip-classes';
import { formatUnassignedReason } from './format-unassigned-reason';

export interface PoolCardRoleSlot {
  slotIndex: number;
  displayName: string | null;
  role: string;
  assignment: {
    id: string;
    displayName: string;
    personId?: string | null;
    /** Engine preview not yet persisted — dashed "Proposed" styling. */
    isProposal?: boolean;
  } | null;
  missingReasons: string[];
}

export interface PoolCardPool<S extends PoolCardRoleSlot> {
  id: string;
  name: string;
  tournamentName: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  members: Array<{ registrationId: string; personName: string; clubLabel?: string | null }>;
  roleSlots: S[];
}

export interface PoolCardConflict {
  kind: string;
  otherPoolName: string;
}

export function PoolSlotCard<S extends PoolCardRoleSlot>({
  pool,
  liceName,
  isReadOnly,
  busy,
  skillNameById,
  skillColorById,
  onAssignClick,
  onUnassign,
  conflictFor,
  onClearPool,
  showLice = true,
}: {
  pool: PoolCardPool<S>;
  liceName: string | null;
  isReadOnly: boolean;
  busy: boolean;
  skillNameById: Map<string, string>;
  skillColorById: Map<string, string>;
  onAssignClick: (slot: S) => void;
  onUnassign: (assignmentId: string) => void;
  /** Scheduling conflict for the band's assignee — forces the band red
   *  and renders the reason line. Omitted on the pools tab. */
  conflictFor?: (personId: string) => PoolCardConflict | undefined;
  /** Renders a trash icon in the header that clears every assignment on
   *  this pool (behind the caller's confirm dialog). */
  onClearPool?: () => void;
  /** The assignments timeslot grid hides the in-card lice line — the
   *  column header already carries it. */
  showLice?: boolean;
}) {
  const { locale } = useI18n();
  // Most-important role first (slot 1 sits on top, then 2, then 3 …).
  const orderedSlots = [...pool.roleSlots].sort((a, b) => a.slotIndex - b.slotIndex);
  return (
    <div className="flex flex-col rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-foreground">
            {pool.tournamentName ? `${pool.tournamentName} – ${pool.name}` : pool.name}
          </p>
          {pool.scheduledStart && (
            <p className="text-xs text-muted">
              {formatHHMM(pool.scheduledStart, locale)}
              {pool.scheduledEnd && `–${formatHHMM(pool.scheduledEnd, locale)}`}
            </p>
          )}
          {showLice && liceName && (
            <p className="text-xs text-muted">
              {t('organizer.poolsPage.refereesLiceLabel').replace('{lice}', liceName)}
            </p>
          )}
        </div>
        {onClearPool && (
          <button
            type="button"
            onClick={onClearPool}
            disabled={isReadOnly || busy}
            aria-label={t('organizer.refereesPage.clearPool')}
            title={t('organizer.refereesPage.clearPool')}
            className="text-muted transition-colors hover:text-danger disabled:cursor-not-allowed disabled:opacity-40"
          >
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
              <path
                fillRule="evenodd"
                d="M8.75 1A1.75 1.75 0 0 0 7 2.75V3.5H3.75a.75.75 0 0 0 0 1.5h.59l.812 11.366A2.25 2.25 0 0 0 7.398 18.5h5.204a2.25 2.25 0 0 0 2.245-2.134L15.66 5h.59a.75.75 0 0 0 0-1.5H13V2.75A1.75 1.75 0 0 0 11.25 1h-2.5zM8.5 2.75A.25.25 0 0 1 8.75 2.5h2.5a.25.25 0 0 1 .25.25V3.5h-3V2.75zM7.75 8a.75.75 0 0 1 .75.75v5.5a.75.75 0 0 1-1.5 0v-5.5A.75.75 0 0 1 7.75 8zm5 0a.75.75 0 0 1 .75.75v5.5a.75.75 0 0 1-1.5 0v-5.5a.75.75 0 0 1 .75-.75z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">
          {t('organizer.refereesPage.refereesSection')}
        </p>
        {orderedSlots.map((slot) => {
          const conflict =
            slot.assignment?.personId && conflictFor
              ? conflictFor(slot.assignment.personId)
              : undefined;
          return (
            <div
              key={`${slot.slotIndex}:${slot.role}`}
              className={[
                'rounded-md border px-3 py-2',
                assignmentChipClasses({
                  hasAssignment: !!slot.assignment,
                  isError: !!conflict || (slot.missingReasons.length > 0 && !slot.assignment),
                  isProposal: slot.assignment?.isProposal ?? false,
                  skillColor: skillColorById.get(slot.role) ?? null,
                }),
              ].join(' ')}
            >
              <p className="text-[10px] font-semibold uppercase tracking-wider opacity-70">
                {slot.displayName ?? skillNameById.get(slot.role) ?? slot.role}
              </p>
              {slot.assignment ? (
                <div className="mt-1 flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">
                    {slot.assignment.displayName}
                    {slot.assignment.isProposal && (
                      <span className="ml-1.5 inline-flex items-center rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700">
                        {t('organizer.refereesPage.proposedTag')}
                      </span>
                    )}
                  </p>
                  <button
                    type="button"
                    disabled={isReadOnly || busy}
                    onClick={() => onUnassign(slot.assignment!.id)}
                    className="text-xs text-danger hover:text-danger-hover disabled:opacity-50"
                  >
                    {t('organizer.poolsPage.refereesUnassign')}
                  </button>
                </div>
              ) : (
                <div className="mt-1 flex items-center justify-between gap-2">
                  <p className="text-sm">{t('organizer.poolsPage.refereesUnassigned')}</p>
                  <button
                    type="button"
                    disabled={isReadOnly || busy}
                    onClick={() => onAssignClick(slot)}
                    className="rounded border border-border px-2 py-0.5 text-xs hover:bg-background disabled:opacity-50"
                  >
                    {t('organizer.poolsPage.refereesAssign')}
                  </button>
                </div>
              )}
              {conflict && (
                <p className="mt-1 text-xs font-medium">
                  {conflict.kind === 'double_booked'
                    ? t('organizer.refereesPage.conflict.alsoOfficiating').replace(
                        '{pool}',
                        conflict.otherPoolName,
                      )
                    : t('organizer.refereesPage.conflict.alsoFighting').replace(
                        '{pool}',
                        conflict.otherPoolName,
                      )}
                </p>
              )}
              {slot.missingReasons.length > 0 && !slot.assignment && (
                <p className="mt-1 text-[10px] text-danger">
                  {slot.missingReasons.map((r) => formatUnassignedReason(r, t)).join(', ')}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {pool.members.length > 0 && (
        <div className="mt-3 border-t border-border pt-3">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
            {t('organizer.refereesPage.fightersSection')}
          </p>
          <ul className="space-y-1">
            {pool.members.map((m) => (
              <li
                key={m.registrationId}
                className="flex items-center justify-between gap-2 text-sm"
              >
                <span className="text-foreground-secondary">{m.personName}</span>
                {m.clubLabel && (
                  <span className="shrink-0 rounded bg-border px-1.5 py-px text-[10px] text-foreground-secondary">
                    {m.clubLabel}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function formatHHMM(iso: string, locale: AppLocale): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString(localeToBcp47(locale), { hour: '2-digit', minute: '2-digit' });
}
