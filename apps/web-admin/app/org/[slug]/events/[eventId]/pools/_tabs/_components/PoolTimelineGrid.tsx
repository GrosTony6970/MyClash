'use client';

/**
 * PoolTimelineGrid — read-only timeline showing every event pool grouped
 * by start time.
 *
 * Built in R3 of the Staffing overhaul. Renders a row per time block:
 * pools whose `scheduledStart` falls within 5 minutes of each other go
 * into the same block. Within each block, pool cards render in a flex
 * row — one per concurrent pool. The cards for pools belonging to the
 * "current tournament" (passed in via `highlightTournamentId`) get a
 * thick ring so the operator can spot their context at a glance.
 *
 * Why this exists: when the organizer is staffing referees on the pool
 * page, they need to see "4 pools at 09:00, break, 4 pools at 10:30" so
 * they can reason about which refs are already busy concurrently.
 * Engine-level time-overlap enforcement is automatic — this is the
 * visual mirror.
 */

import { useMemo } from 'react';
import { t } from '@myclash/i18n';
import { groupPoolsByTimeslot } from '../../../referees/_components/group-pools-by-timeslot';

export interface TimelinePool {
  id: string;
  name: string;
  tournamentId: string;
  tournamentName: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  liceName: string | null;
  /** Filled slot count for the badge (`X/Y`). 0 when board not loaded yet. */
  filledSlotCount: number;
  totalSlotCount: number;
}

/** A non-competition programme block (break / admin / workshop) interleaved
 *  with the pool rows so the timeline mirrors the day's shape. */
export interface TimelineBreak {
  startIso: string;
  label: string;
  /** 'break' | 'admin' | 'workshop' — drives the bar tint. */
  kind: string;
}

interface Props {
  pools: TimelinePool[];
  /** Non-pool programme blocks to interleave as full-width bars. */
  breaks?: TimelineBreak[];
  /** Pools of this tournament render with a highlight ring. Omit (the
   *  event-level assignments tab) and no chip is highlighted. */
  highlightTournamentId?: string | null;
  /** When provided, chips become buttons — the assignments tab uses
   *  this to expand an unscheduled pool's card / jump to a timeslot. */
  onPoolClick?: (pool: TimelinePool) => void;
}

/** Order pools Lice 1 → Lice 2 → … (numeric so "Lice 10" sorts after "Lice 2");
 *  pools without a lice fall to the end. */
function byLice(a: TimelinePool, b: TimelinePool): number {
  return (a.liceName ?? '￿').localeCompare(b.liceName ?? '￿', undefined, {
    numeric: true,
  });
}

/** Programme-block bar tint per kind. */
function breakBarClasses(kind: string): string {
  if (kind === 'break') return 'border-slate-300 bg-slate-100 text-slate-600';
  if (kind === 'workshop') return 'border-amber-300 bg-amber-50 text-amber-800';
  return 'border-purple-300 bg-purple-50 text-purple-800';
}

export function PoolTimelineGrid({ pools, breaks, highlightTournamentId, onPoolClick }: Props) {
  const { blocks, unscheduled } = useMemo(() => groupPoolsByTimeslot(pools), [pools]);
  const unscheduledByLice = useMemo(() => [...unscheduled].sort(byLice), [unscheduled]);
  // Merge timeslot rows with break bars, ordered by start time.
  const rows = useMemo(
    () =>
      [
        ...blocks.map((block) => ({
          kind: 'slot' as const,
          ms: new Date(block.startTime).getTime(),
          block,
        })),
        ...(breaks ?? []).map((brk) => ({
          kind: 'break' as const,
          ms: new Date(brk.startIso).getTime(),
          brk,
        })),
      ].sort((a, b) => a.ms - b.ms),
    [blocks, breaks],
  );

  if (blocks.length === 0 && unscheduled.length === 0) {
    return (
      <p className="text-sm text-gray-400">{t('organizer.poolsPage.refereesTimelineEmpty')}</p>
    );
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-500">
        {t('organizer.poolsPage.refereesTimelineTitle')}
      </h3>
      <div className="space-y-3">
        {rows.map((row) =>
          row.kind === 'break' ? (
            <div
              key={`break-${row.brk.startIso}-${row.brk.label}`}
              className={`rounded-md border px-3 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wide ${breakBarClasses(
                row.brk.kind,
              )}`}
            >
              {row.brk.label}
            </div>
          ) : (
            <div key={row.block.startTime} className="flex items-start gap-3">
              <div className="w-20 shrink-0 pt-2 text-right">
                <div className="text-[10px] leading-tight text-gray-400">
                  {formatDay(row.block.startTime)}
                </div>
                <div className="text-xs font-semibold tabular-nums text-gray-600">
                  {formatHHMM(row.block.startTime)}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {[...row.block.pools].sort(byLice).map((pool) => (
                  <PoolCard
                    key={pool.id}
                    pool={pool}
                    highlighted={pool.tournamentId === highlightTournamentId}
                    onClick={onPoolClick}
                  />
                ))}
              </div>
            </div>
          ),
        )}
        {unscheduledByLice.length > 0 && (
          <div className="flex items-start gap-3 border-t border-gray-100 pt-3">
            <div className="w-20 shrink-0 pt-2 text-right text-xs font-semibold uppercase leading-tight break-words text-gray-400">
              {t('organizer.poolsPage.refereesTimelineUnscheduled')}
            </div>
            <div className="flex flex-wrap gap-2">
              {unscheduledByLice.map((pool) => (
                <PoolCard
                  key={pool.id}
                  pool={pool}
                  highlighted={pool.tournamentId === highlightTournamentId}
                  onClick={onPoolClick}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function PoolCard({
  pool,
  highlighted,
  onClick,
}: {
  pool: TimelinePool;
  highlighted: boolean;
  onClick?: (pool: TimelinePool) => void;
}) {
  // Chips are read-only on the pools tab; the assignments tab passes
  // onClick so a chip can expand its card / jump to its timeslot.
  const Tag = onClick ? 'button' : 'div';
  // Red ring means "needs a referee" — a pool with at least one empty slot.
  // A fully-staffed pool is never red; the current-tournament context cue is
  // kept as a subtle non-red border instead.
  const incomplete = pool.totalSlotCount > 0 && pool.filledSlotCount < pool.totalSlotCount;
  return (
    <Tag
      {...(onClick ? { type: 'button' as const, onClick: () => onClick(pool) } : {})}
      className={[
        'rounded-md border bg-white px-3 py-2 text-left text-xs shadow-sm transition-colors',
        onClick ? 'cursor-pointer' : '',
        incomplete
          ? 'border-red-500 ring-2 ring-red-200'
          : highlighted
            ? 'border-gray-300'
            : 'border-gray-200 hover:border-gray-300',
      ].join(' ')}
      title={`${pool.tournamentName} - ${pool.name}`}
    >
      <p className="font-semibold text-gray-900">{pool.name}</p>
      <p className="text-[10px] text-gray-500">{pool.tournamentName}</p>
      <div className="mt-1 flex items-center justify-between gap-2 text-[10px]">
        {pool.liceName && <span className="text-gray-400">{pool.liceName}</span>}
        <span
          className={[
            'tabular-nums font-semibold',
            pool.filledSlotCount === pool.totalSlotCount && pool.totalSlotCount > 0
              ? 'text-emerald-600'
              : 'text-amber-600',
          ].join(' ')}
        >
          {pool.filledSlotCount}/{pool.totalSlotCount}
        </span>
      </div>
    </Tag>
  );
}

function formatHHMM(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

/** Compact day label above the time so multi-day events are unambiguous,
 *  e.g. "sam. 21/06". Same 'fr-FR' locale as the time formatter. */
function formatDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' });
}
