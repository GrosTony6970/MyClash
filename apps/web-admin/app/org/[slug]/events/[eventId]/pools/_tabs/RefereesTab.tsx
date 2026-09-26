'use client';

/**
 * RefereesTab — per-pool-phase referee assignment view.
 *
 * Built in R3 of the Staffing overhaul. The pool detail page previously
 * had no in-context surface for referee assignment — operators had to
 * click out to /referees#assignments to see who was on which pool. This
 * tab brings the assignment workflow into the pool detail page, scoped
 * to the current tournament's pools.
 *
 * Layout (top → bottom):
 *   1. PoolTimelineGrid — this tournament's pools grouped by start time.
 *      Lets the operator see "4 pools at 09:00, break, 4 at 10:30" and
 *      reason about parallel ref availability.
 *   2. Concurrent-pools list — pools (from other tournaments) whose
 *      time window overlaps with any pool in this tournament. Shows
 *      currently-assigned refs so the operator knows who's locked out.
 *   3. Slot cards per tournament pool — current assignment + Assign /
 *      Unassign buttons.
 *
 * The board itself — fetch, catalogues, assign/unassign/swap — lives in the
 * shared `useAssignmentBoard` hook, so this file is the pool-specific layout
 * and nothing else. The bracket and Swiss tabs read the same payload.
 */

import { useMemo, useState } from 'react';
import { type AppLocale } from '@myclash/time';
import { useI18n } from '@myclash/next-i18n/client';
import { PoolTimelineGrid, type TimelinePool } from './_components/PoolTimelineGrid';
import { PoolSlotCard } from '../../referees/_components/PoolSlotCard';
import { CandidatePicker } from '../../referees/_components/CandidatePicker';
import { formatHHMM } from '../../referees/_components/format-hhmm';
import {
  useAssignmentBoard,
  type AssignmentBoardPool,
  type AssignmentBoardRoleSlot,
} from '../../referees/_components/useAssignmentBoard';

interface Props {
  eventId: string;
  tournamentId: string;
  isReadOnly: boolean;
}

export function RefereesTab({ eventId, tournamentId, isReadOnly }: Props) {
  const { locale, t } = useI18n();
  const {
    board,
    allBoardPools,
    loading,
    busy,
    error,
    skillNameById,
    skillColorById,
    liceNameById,
    manualAssign,
    unassign,
  } = useAssignmentBoard(eventId, {
    loadFailed: t('organizer.poolsPage.refereesLoadFailed'),
    mutationFailed: t('organizer.poolsPage.refereesAssignFailed'),
  });
  const [picker, setPicker] = useState<{
    pool: AssignmentBoardPool;
    slot: AssignmentBoardRoleSlot;
  } | null>(null);

  const tournamentPools = useMemo(
    () =>
      allBoardPools.filter((p) => p.tournamentId === tournamentId && (p.kind ?? 'pool') === 'pool'),
    [allBoardPools, tournamentId],
  );

  const timelinePools = useMemo<TimelinePool[]>(
    () =>
      // Pools only — bracket/finals matches are staffed in the bracket
      // section, so they don't belong on the pool timeline.
      allBoardPools
        .filter((p) => (p.kind ?? 'pool') === 'pool')
        .map((p) => ({
          id: p.id,
          name: p.name,
          tournamentId: p.tournamentId,
          tournamentName: p.tournamentName,
          scheduledStart: p.scheduledStart,
          scheduledEnd: p.scheduledEnd,
          liceName: p.liceId ? (liceNameById.get(p.liceId) ?? null) : null,
          filledSlotCount: p.roleSlots.filter((s) => s.assignment !== null).length,
          totalSlotCount: p.roleSlots.length,
        })),
    [allBoardPools, liceNameById],
  );

  /**
   * Scheduled units from OTHER tournaments whose time window overlaps a pool in this
   * one, for the panel that shows what runs alongside. Deliberately unfiltered by
   * `kind`: a bracket match at an overlapping time runs alongside just as a pool does.
   * Who may referee is not decided here — the server's one checker (ADR-016) already
   * sorted every candidate the picker shows, other Tournaments' duties included.
   */
  const concurrentPools = useMemo(() => {
    if (tournamentPools.length === 0) return [] as AssignmentBoardPool[];
    return allBoardPools.filter((other) => {
      if (other.tournamentId === tournamentId) return false;
      if (!other.scheduledStart || !other.scheduledEnd) return false;
      return tournamentPools.some((mine) => {
        if (!mine.scheduledStart || !mine.scheduledEnd) return false;
        const ms = new Date(mine.scheduledStart).getTime();
        const me = new Date(mine.scheduledEnd).getTime();
        const os = new Date(other.scheduledStart!).getTime();
        const oe = new Date(other.scheduledEnd!).getTime();
        return ms < oe && os < me;
      });
    });
  }, [allBoardPools, tournamentPools, tournamentId]);

  if (loading && !board) {
    return <p className="text-sm text-muted">{t('organizer.poolsPage.refereesLoading')}</p>;
  }
  if (!board || tournamentPools.length === 0) {
    return (
      <div className="rounded-lg border-2 border-dashed border-border p-8 text-center">
        <p className="text-sm text-muted">{t('organizer.poolsPage.refereesEmpty')}</p>
      </div>
    );
  }

  return (
    <section className="space-y-4">
      {error && (
        <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      {/* This mount really is pool-only — see timelinePools above — so it
          keeps the pool-flavoured heading. */}
      <PoolTimelineGrid
        pools={timelinePools}
        title={t('organizer.poolsPage.refereesTimelineTitle')}
        emptyLabel={t('organizer.poolsPage.refereesTimelineEmpty')}
      />

      {concurrentPools.length > 0 && (
        <ConcurrentPoolsPanel pools={concurrentPools} locale={locale} />
      )}

      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
          {t('organizer.poolsPage.refereesSlotCardsTitle')}
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {tournamentPools.map((pool) => (
            <PoolSlotCard
              key={pool.id}
              pool={pool}
              liceName={pool.liceId ? (liceNameById.get(pool.liceId) ?? null) : null}
              isReadOnly={isReadOnly || board.locked}
              busy={busy}
              skillNameById={skillNameById}
              skillColorById={skillColorById}
              onAssignClick={(slot) => setPicker({ pool, slot })}
              onUnassign={(assignmentId) => void unassign(assignmentId)}
            />
          ))}
        </div>
      </section>

      {picker && (
        <CandidatePicker
          pool={picker.pool}
          slot={picker.slot}
          onAssign={(personId, confirm) => {
            void manualAssign(picker.pool.id, picker.slot.role, personId, confirm).then((ok) => {
              if (ok) setPicker(null);
            });
          }}
          onCancel={() => setPicker(null)}
        />
      )}
    </section>
  );
}

// ── Subcomponents ─────────────────────────────────────────────────────────────
// PoolSlotCard moved to ../../referees/_components/PoolSlotCard.tsx so the
// event-level Assignments tab's timeslot grid renders the same card.

function ConcurrentPoolsPanel({
  pools,
  locale,
}: {
  pools: AssignmentBoardPool[];
  locale: AppLocale;
}) {
  const { t } = useI18n();

  return (
    <section className="rounded-lg border border-warning/30 bg-warning/10 p-4">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-warning">
        {t('organizer.poolsPage.refereesConcurrentTitle')}
      </h3>
      <p className="mb-3 text-xs text-warning">
        {t('organizer.poolsPage.refereesConcurrentBody', { count: pools.length })}
      </p>
      <ul className="space-y-1 text-xs">
        {pools.map((pool) => {
          const assigned = pool.roleSlots
            .filter((s) => s.assignment !== null)
            .map((s) => s.assignment!.displayName);
          return (
            <li key={pool.id} className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-foreground">
                {pool.tournamentName} · {pool.name}
                {pool.scheduledStart && (
                  <span className="ml-1 text-muted">
                    ({formatHHMM(pool.scheduledStart, locale)})
                  </span>
                )}
              </span>
              <span className="text-foreground-secondary">
                {assigned.length > 0
                  ? assigned.join(', ')
                  : t('organizer.poolsPage.refereesUnassigned')}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
