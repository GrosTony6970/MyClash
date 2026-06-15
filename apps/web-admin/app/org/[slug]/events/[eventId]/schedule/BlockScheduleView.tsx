'use client';

/* eslint-disable myclash/no-literal-string */

/**
 * BlockScheduleView — the readable, "global" schedule view: one collapsed
 * block per pool / bracket round, laid out in per-lice columns under venue
 * headers, ordered by start time and interleaved with break bars. Clicking
 * a block expands an inline accordion listing each match (code · start ·
 * fighters). Replaces the dense fixed time-slot grid.
 *
 * Presentational + drag wiring only — the data model comes from
 * `buildScheduleBlocks` and moves are persisted by the parent.
 */

import { tintBgClassFor, tintBorderClassFor, tintTextClassFor } from '@myclash/ui';
import type { ScheduleBlock } from './schedule-blocks';

export interface ViewLice {
  id: string;
  name: string;
  venues?: { id: string; name: string } | null;
}

export interface ViewBreak {
  id: string;
  startIso: string;
  label: string;
  /** 'break' | 'admin' | 'workshop' — drives the bar tint. */
  kind: string;
}

interface Props {
  lices: ViewLice[];
  blocks: ScheduleBlock[];
  breaks: ViewBreak[];
  tournamentColorByName: Map<string, string | null>;
  /** Quick-assign start time ("HH:MM"); blank = append to the lice. */
  quickStartTime: string;
  onQuickStartTimeChange: (value: string) => void;
  expandedKey: string | null;
  onToggleExpand: (key: string) => void;
  /** Drag source: the operator grabbed a scheduled block. */
  onBlockDragStart: (block: ScheduleBlock) => void;
  onBlockDragEnd: () => void;
  /** Drop target: a block (or an Unscheduled item) was dropped on a lice. */
  onDropOnLice: (liceId: string) => void;
  dragOverLiceId: string | null;
  onDragOverLice: (liceId: string | null) => void;
}

function hhmm(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso),
  );
}

function breakBarClasses(kind: string): string {
  if (kind === 'break') return 'border-slate-300 bg-slate-100 text-slate-600';
  if (kind === 'workshop') return 'border-amber-300 bg-amber-50 text-amber-800';
  return 'border-purple-300 bg-purple-50 text-purple-800';
}

/** Consecutive same-venue lices share one header group. */
function venueGroups(lices: ViewLice[]): Array<{ venueName: string | null; span: number }> {
  const groups: Array<{ venueName: string | null; span: number }> = [];
  for (const l of lices) {
    const name = l.venues?.name ?? null;
    const last = groups[groups.length - 1];
    if (last && last.venueName === name) last.span += 1;
    else groups.push({ venueName: name, span: 1 });
  }
  return groups;
}

export function BlockScheduleView({
  lices,
  blocks,
  breaks,
  tournamentColorByName,
  quickStartTime,
  onQuickStartTimeChange,
  expandedKey,
  onToggleExpand,
  onBlockDragStart,
  onBlockDragEnd,
  onDropOnLice,
  dragOverLiceId,
  onDragOverLice,
}: Props) {
  if (lices.length === 0) {
    return <p className="text-sm text-gray-400">No lices configured for this event.</p>;
  }

  // Per-lice column items: blocks + break bars, ordered by start time.
  type Item =
    | { kind: 'block'; ms: number; block: ScheduleBlock }
    | { kind: 'break'; ms: number; brk: ViewBreak };
  const itemsByLice = new Map<string, Item[]>();
  for (const l of lices) itemsByLice.set(l.id, []);
  for (const b of blocks) {
    itemsByLice
      .get(b.liceId)
      ?.push({ kind: 'block', ms: new Date(b.startIso).getTime(), block: b });
  }
  // Breaks are event-wide (all lices) — show them in every column so each
  // lice's timeline reads correctly.
  for (const br of breaks) {
    const ms = new Date(br.startIso).getTime();
    for (const items of itemsByLice.values()) items.push({ kind: 'break', ms, brk: br });
  }
  for (const items of itemsByLice.values()) items.sort((a, b) => a.ms - b.ms);

  return (
    <div className="overflow-x-auto pb-2">
      {/* Quick-assign: pick a start time, then drop a block onto a lice to
          place it there. Blank = append after the lice's last match. */}
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
        <span className="font-semibold uppercase tracking-wide text-gray-500">Quick assign</span>
        <label className="flex items-center gap-1.5 text-gray-700">
          Start
          <input
            type="time"
            value={quickStartTime}
            onChange={(e) => onQuickStartTimeChange(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          />
        </label>
        {quickStartTime ? (
          <button
            type="button"
            onClick={() => onQuickStartTimeChange('')}
            className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100"
          >
            Clear
          </button>
        ) : null}
        <span className="text-xs italic text-gray-400">
          {quickStartTime
            ? `Dropping a block on a lice starts it at ${quickStartTime}.`
            : 'Dropping a block on a lice appends it after the last match.'}
        </span>
      </div>
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(${lices.length}, minmax(220px, 1fr))` }}
      >
        {/* Venue header band */}
        {venueGroups(lices).map((g, i) => (
          <div
            key={`venue-${i}`}
            style={{ gridColumn: `span ${g.span}` }}
            className="rounded-t-md border-b border-blue-200 bg-blue-50 px-2 py-1 text-center text-sm font-semibold text-blue-800 truncate"
          >
            {g.venueName ?? 'No venue'}
          </div>
        ))}

        {/* Lice columns */}
        {lices.map((lice) => {
          const items = itemsByLice.get(lice.id) ?? [];
          const isOver = dragOverLiceId === lice.id;
          return (
            <div
              key={lice.id}
              onDragOver={(e) => {
                e.preventDefault();
                if (!isOver) onDragOverLice(lice.id);
              }}
              onDragLeave={() => {
                if (isOver) onDragOverLice(null);
              }}
              onDrop={() => {
                onDragOverLice(null);
                onDropOnLice(lice.id);
              }}
              className={[
                'flex min-h-[120px] flex-col gap-2 rounded-lg border p-2 transition-colors',
                isOver
                  ? 'border-blue-400 bg-blue-50 ring-2 ring-inset ring-blue-300'
                  : 'border-gray-200 bg-gray-50',
              ].join(' ')}
            >
              <p className="text-center text-xs font-bold uppercase tracking-wider text-gray-600">
                {lice.name}
              </p>
              {items.length === 0 ? (
                <p className="py-6 text-center text-xs italic text-gray-300">idle</p>
              ) : (
                items.map((item) =>
                  item.kind === 'break' ? (
                    <div
                      key={`brk-${item.brk.id}`}
                      className={`rounded border px-2 py-1 text-center text-[11px] font-semibold uppercase tracking-wide ${breakBarClasses(
                        item.brk.kind,
                      )}`}
                    >
                      {item.brk.label}
                    </div>
                  ) : (
                    (() => {
                      const blk = item.block;
                      const color = tournamentColorByName.get(blk.tournamentName ?? '') ?? null;
                      const expanded = expandedKey === blk.key;
                      return (
                        <div
                          key={blk.key}
                          draggable
                          onDragStart={() => onBlockDragStart(blk)}
                          onDragEnd={onBlockDragEnd}
                          className={[
                            'cursor-grab overflow-hidden rounded-md border active:cursor-grabbing',
                            tintBgClassFor(color),
                            tintBorderClassFor(color),
                          ].join(' ')}
                        >
                          <button
                            type="button"
                            onClick={() => onToggleExpand(blk.key)}
                            className={`flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left ${tintTextClassFor(
                              color,
                            )}`}
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-bold">{blk.label}</span>
                              <span className="block truncate text-[10px] opacity-80">
                                {blk.matchCount} matches · {hhmm(blk.startIso)}–{hhmm(blk.endIso)}
                              </span>
                            </span>
                            <span aria-hidden="true" className="shrink-0 text-xs opacity-70">
                              {expanded ? '▾' : '▸'}
                            </span>
                          </button>
                          {expanded && (
                            <ul className="divide-y divide-black/5 border-t border-black/10 bg-white/70">
                              {blk.matches.map((m) => (
                                <li key={m.id} className="px-2 py-1 text-[11px] text-gray-700">
                                  <span className="font-mono text-[10px] text-gray-500">
                                    {m.code}
                                  </span>{' '}
                                  <span className="font-semibold tabular-nums">
                                    {hhmm(m.startIso)}
                                  </span>
                                  <span className="block truncate">
                                    {m.redFighterName ?? '?'}{' '}
                                    <span className="text-gray-400">vs</span>{' '}
                                    {m.blueFighterName ?? '?'}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      );
                    })()
                  ),
                )
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
