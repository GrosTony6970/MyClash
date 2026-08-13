'use client';

/**
 * Referee assignment for the Swiss phase.
 *
 * The assignable unit is a (round × piste): the consecutive bouts of one round
 * on one piste, which is genuinely pool-shaped — one crew, one piste,
 * back-to-back bouts — so the rest / no-back-to-back constraints stay
 * meaningful. The backend emits those units on the same board the pool and
 * bracket tabs read, so this is a filter and a grouping, not a second engine.
 *
 * Bulk clear is per ROUND, not per unit: an organiser redoing a round's crew
 * means the whole round, and clearing one piste at a time invites leaving half
 * of it staffed.
 */

import { useI18n } from '@myclash/next-i18n/client';
import { useMemo, useState } from 'react';
import { ConfirmDialog, useToast } from '@myclash/ui';
import { PoolSlotCard } from '../../referees/_components/PoolSlotCard';
import { CandidatePicker } from '../../referees/_components/CandidatePicker';
import {
  useAssignmentBoard,
  type AssignmentBoardPool,
  type AssignmentBoardRoleSlot,
} from '../../referees/_components/useAssignmentBoard';
import { getPublicApiUrl } from '@/lib/api-url';

export function RefereesTab({
  eventId,
  tournamentId,
  isReadOnly,
}: {
  eventId: string;
  tournamentId: string;
  isReadOnly: boolean;
}) {
  const { t } = useI18n();

  const toast = useToast();
  const {
    board,
    allBoardPools,
    loading,
    busy,
    error,
    skillNameById,
    skillColorById,
    liceNameById,
    reload,
    manualAssign,
    unassign,
  } = useAssignmentBoard(eventId, {
    loadFailed: t('organizer.swiss.referees.loadFailed'),
    mutationFailed: t('organizer.swiss.referees.assignFailed'),
  });
  const [picker, setPicker] = useState<{
    pool: AssignmentBoardPool;
    slot: AssignmentBoardRoleSlot;
  } | null>(null);
  const [pendingClear, setPendingClear] = useState<{ roundId: string; round: number } | null>(null);
  const [clearing, setClearing] = useState(false);

  /** A POSITIVE filter — pool and bracket units share this payload. */
  const rounds = useMemo(() => {
    const units = allBoardPools.filter(
      (pool) => pool.tournamentId === tournamentId && pool.kind === 'swiss',
    );
    const byRound = new Map<number, { roundId: string | null; units: AssignmentBoardPool[] }>();
    for (const unit of units) {
      const number = unit.swissRound ?? 0;
      const entry = byRound.get(number);
      if (entry) entry.units.push(unit);
      else byRound.set(number, { roundId: unit.swissRoundId ?? null, units: [unit] });
    }
    return [...byRound.entries()].sort((a, b) => a[0] - b[0]);
  }, [allBoardPools, tournamentId]);

  async function clearRound(roundId: string) {
    setClearing(true);
    try {
      const res = await fetch(
        `${getPublicApiUrl()}/api/v1/swiss-rounds/${roundId}/referee-assignments`,
        { method: 'DELETE', credentials: 'include' },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        toast.error(body.message ?? t('organizer.swiss.referees.clearFailed'));
        return;
      }
      toast.success(t('organizer.swiss.referees.cleared'));
      await reload();
    } finally {
      setClearing(false);
      setPendingClear(null);
    }
  }

  if (loading && !board) {
    return <p className="text-sm text-muted">{t('organizer.swiss.referees.loading')}</p>;
  }
  if (!board || rounds.length === 0) {
    return (
      <div className="rounded-lg border-2 border-dashed border-border p-8 text-center">
        <p className="text-sm text-muted">{t('organizer.swiss.referees.empty')}</p>
      </div>
    );
  }

  const readOnly = isReadOnly || board.locked;

  return (
    <section className="space-y-6">
      {error && (
        <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      {rounds.map(([number, group]) => (
        <section key={number} className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
              {t('organizer.swiss.referees.roundTitle', { round: number })}
            </h3>
            {group.roundId && !readOnly && (
              <button
                type="button"
                disabled={clearing}
                onClick={() => setPendingClear({ roundId: group.roundId!, round: number })}
                className="rounded border border-danger/40 px-2.5 py-1 text-xs font-semibold text-danger hover:bg-danger/10 disabled:opacity-40"
              >
                {t('organizer.swiss.referees.clearRound')}
              </button>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {group.units.map((unit) => (
              <PoolSlotCard
                key={unit.id}
                pool={unit}
                liceName={unit.liceId ? (liceNameById.get(unit.liceId) ?? null) : null}
                isReadOnly={readOnly}
                busy={busy}
                skillNameById={skillNameById}
                skillColorById={skillColorById}
                onAssignClick={(slot) => setPicker({ pool: unit, slot })}
                onUnassign={(assignmentId) => void unassign(assignmentId)}
              />
            ))}
          </div>
        </section>
      ))}

      {picker && (
        <CandidatePicker
          pool={picker.pool}
          slot={picker.slot}
          onAssign={(userId) => {
            void manualAssign(picker.pool.id, picker.slot.role, userId).then((ok) => {
              if (ok) setPicker(null);
            });
          }}
          onCancel={() => setPicker(null)}
        />
      )}

      <ConfirmDialog
        open={pendingClear !== null}
        title={t('organizer.swiss.referees.clearTitle', { round: pendingClear?.round ?? 0 })}
        description={t('organizer.swiss.referees.clearBody')}
        confirmLabel={t('organizer.swiss.referees.clearConfirm')}
        danger
        busy={clearing}
        onCancel={() => setPendingClear(null)}
        onConfirm={() => {
          if (pendingClear) void clearRound(pendingClear.roundId);
        }}
      />
    </section>
  );
}
