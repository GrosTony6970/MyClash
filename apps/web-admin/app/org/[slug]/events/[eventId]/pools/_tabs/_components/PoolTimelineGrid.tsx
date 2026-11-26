'use client';

/**
 * PoolTimelineGrid — read-only timeline showing every event pool grouped
 * by start time.
 *
 * Built in R3 of the Staffing overhaul. Renders a row per time block:
 * pools whose `scheduledStart` falls within 5 minutes of each other go
 * into the same block. Within each block, pool cards render in a flex
 * row — one per concurrent pool.
 *
 * Why this exists: when the organizer is staffing referees on the pool
 * page, they need to see "4 pools at 09:00, break, 4 pools at 10:30" so
 * they can reason about which refs are already busy concurrently.
 * Engine-level time-overlap enforcement is automatic — this is the
 * visual mirror.
 *
 * Rows are cut into Event days, each under its own heading, along a rail
 * that ends in an arrow: time runs down the page. Days and times are read on
 * the Event's clock (`timeZone`), never the browser's. The section folds, and
 * the fold is remembered per Event (`timeline-collapse.ts`).
 */

import { useMemo, useState } from 'react';
import { formatInZone, localeToBcp47, type AppLocale } from '@myclash/time';
import { blockTint, resolveBlockAccent } from '@myclash/types';
import { CollapsibleSection } from '@myclash/ui';
import { groupPoolsByTimeslot } from '../../../referees/_components/group-pools-by-timeslot';
import { useI18n } from '@myclash/next-i18n/client';
import { buildTimelineDays, type TimelineDayGroup, type TimelineRow } from './timeline-days';
import { rememberCollapsed, rememberedCollapsed } from './timeline-collapse';

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
  /**
   * Heading and empty-state copy, already translated by the caller.
   *
   * The caller owns these because the two mounts show different things: the
   * pools tab passes a pool-filtered list, so its heading may say "pool", while
   * the referee workspace passes every kind of scheduled unit and must not.
   */
  title: string;
  emptyLabel: string;
  /** The Event's IANA zone: days and times are read on its clock. */
  timeZone: string;
  /** Keys the remembered fold. */
  eventId: string;
  /** Non-pool programme blocks to interleave as full-width bars. */
  breaks?: TimelineBreak[];
  /** When provided, chips become buttons — the assignments tab uses
   *  this to expand an unscheduled pool's card / jump to a timeslot. */
  onPoolClick?: (pool: TimelinePool) => void;
}

type Row = TimelineRow<TimelinePool, TimelineBreak>;

/** Order pools Lice 1 → Lice 2 → … (numeric so "Lice 10" sorts after "Lice 2");
 *  pools without a lice fall to the end. */
function byLice(a: TimelinePool, b: TimelinePool): number {
  return (a.liceName ?? '￿').localeCompare(b.liceName ?? '￿', undefined, {
    numeric: true,
  });
}

export function PoolTimelineGrid({
  pools,
  title,
  emptyLabel,
  timeZone,
  eventId,
  breaks,
  onPoolClick,
}: Props) {
  const { locale, t } = useI18n();
  const { blocks, unscheduled } = useMemo(() => groupPoolsByTimeslot(pools), [pools]);
  const unscheduledByLice = useMemo(() => [...unscheduled].sort(byLice), [unscheduled]);
  const days = useMemo(
    () => buildTimelineDays(blocks, breaks ?? [], timeZone),
    [blocks, breaks, timeZone],
  );
  // Both mounts render this only after their client-side fetch, so the
  // initialiser never runs on the server.
  const [open, setOpen] = useState(() => !rememberedCollapsed(eventId));
  const isEmpty = blocks.length === 0 && unscheduled.length === 0;

  function toggle() {
    rememberCollapsed(eventId, open);
    setOpen(!open);
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      {/* The title is the toggle, so the button is named for what it folds. */}
      <CollapsibleSection
        open={open}
        onToggle={toggle}
        header={
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">{title}</span>
        }
        bodyClassName="mt-3 space-y-5"
      >
        {/* The empty state stays INSIDE the card. It used to return a bare
            sentence and skip the section entirely, so the whole block vanished
            off the page — which reads as a broken page rather than as a filter
            that matched nothing, and the tournament filter makes it reachable
            on purpose. */}
        {isEmpty && <p className="text-sm text-muted">{emptyLabel}</p>}
        {days.map((group) => (
          <TimelineDay
            key={group.day}
            group={group}
            timeZone={timeZone}
            locale={locale}
            onPoolClick={onPoolClick}
          />
        ))}
        {unscheduledByLice.length > 0 && (
          <div className="flex items-start gap-3 border-t border-border pt-3">
            <div className="w-20 shrink-0 pt-2 text-right text-xs font-semibold uppercase leading-tight break-words text-muted">
              {t('organizer.poolsPage.refereesTimelineUnscheduled')}
            </div>
            <div className="flex flex-wrap gap-2">
              {unscheduledByLice.map((pool) => (
                <PoolCard key={pool.id} pool={pool} onClick={onPoolClick} />
              ))}
            </div>
          </div>
        )}
      </CollapsibleSection>
    </section>
  );
}

/** One Event day: its heading, then its rows along the rail, then the arrow. */
function TimelineDay({
  group,
  timeZone,
  locale,
  onPoolClick,
}: {
  group: TimelineDayGroup<TimelinePool, TimelineBreak>;
  timeZone: string;
  locale: AppLocale;
  onPoolClick?: (pool: TimelinePool) => void;
}) {
  const dayLabel = formatInZone(
    group.rows[0]?.startIso,
    timeZone,
    { weekday: 'long', day: '2-digit', month: '2-digit' },
    localeToBcp47(locale),
  );
  return (
    <div>
      <h4 className="mb-2 border-b border-border pb-1 text-sm font-semibold capitalize text-foreground">
        {dayLabel}
      </h4>
      <ol>
        {group.rows.map((row) => (
          <li key={rowKey(row)} className="flex items-stretch gap-3">
            <div className="w-14 shrink-0 pt-2 text-right text-xs font-semibold tabular-nums text-foreground-secondary">
              {formatInZone(
                row.startIso,
                timeZone,
                { hour: '2-digit', minute: '2-digit' },
                localeToBcp47(locale),
              )}
            </div>
            <RailSegment row={row} />
            <div className="min-w-0 flex-1 pb-3">
              <RowBody row={row} onPoolClick={onPoolClick} />
            </div>
          </li>
        ))}
      </ol>
      {/* Time runs down the page: the rail ends in an arrow under the day. */}
      <div className="flex gap-3" aria-hidden="true">
        <div className="w-14 shrink-0" />
        <div className="flex w-3 shrink-0 justify-center text-xs leading-none text-muted">▼</div>
      </div>
    </div>
  );
}

function rowKey(row: Row): string {
  return row.kind === 'slot' ? `slot-${row.startIso}` : `break-${row.startIso}-${row.brk.label}`;
}

/** The rail's piece beside one row: a line the full height of the row and a
 *  dot level with its time — accent for a timeslot, the bar's tint for a bar. */
function RailSegment({ row }: { row: Row }) {
  const dotStyle =
    row.kind === 'break' ? { backgroundColor: resolveBlockAccent(row.brk.kind, null) } : undefined;
  return (
    <div className="relative flex w-3 shrink-0 justify-center" aria-hidden="true">
      <span className="absolute inset-y-0 w-0.5 bg-border" />
      <span
        className={[
          'relative mt-3 h-2.5 w-2.5 rounded-full ring-2 ring-surface',
          row.kind === 'slot' ? 'bg-accent' : '',
        ].join(' ')}
        style={dotStyle}
      />
    </div>
  );
}

function RowBody({ row, onPoolClick }: { row: Row; onPoolClick?: (pool: TimelinePool) => void }) {
  if (row.kind === 'break') {
    return (
      <div
        // This projection carries no colorHex, so a bar here always shows
        // the kind's default accent — the same one every other board and
        // the organiser's swatch picker resolve to.
        style={blockTint(resolveBlockAccent(row.brk.kind, null))}
        className="mt-1 rounded-md border px-3 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-foreground-secondary"
      >
        {row.brk.label}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      {[...row.block.pools].sort(byLice).map((pool) => (
        <PoolCard key={pool.id} pool={pool} onClick={onPoolClick} />
      ))}
    </div>
  );
}

function PoolCard({
  pool,
  onClick,
}: {
  pool: TimelinePool;
  onClick?: (pool: TimelinePool) => void;
}) {
  // Chips are read-only on the pools tab; the assignments tab passes
  // onClick so a chip can expand its card / jump to its timeslot.
  const Tag = onClick ? 'button' : 'div';
  // Red ring means "needs a referee" — a pool with at least one empty slot.
  // A fully-staffed pool is never red.
  const incomplete = pool.totalSlotCount > 0 && pool.filledSlotCount < pool.totalSlotCount;
  return (
    <Tag
      {...(onClick ? { type: 'button' as const, onClick: () => onClick(pool) } : {})}
      className={[
        'rounded-md border bg-surface px-3 py-2 text-left text-xs shadow-sm transition-colors',
        onClick ? 'cursor-pointer' : '',
        incomplete ? 'border-danger ring-2 ring-danger/30' : 'border-border',
      ].join(' ')}
      title={`${pool.tournamentName} - ${pool.name}`}
    >
      <p className="font-semibold text-foreground">{pool.name}</p>
      <p className="text-[10px] text-muted">{pool.tournamentName}</p>
      <div className="mt-1 flex items-center justify-between gap-2 text-[10px]">
        {pool.liceName && <span className="text-muted">{pool.liceName}</span>}
        <span
          className={[
            'tabular-nums font-semibold',
            pool.filledSlotCount === pool.totalSlotCount && pool.totalSlotCount > 0
              ? 'text-success'
              : 'text-warning',
          ].join(' ')}
        >
          {pool.filledSlotCount}/{pool.totalSlotCount}
        </span>
      </div>
    </Tag>
  );
}
