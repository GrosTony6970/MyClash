'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';

type PenaltyCard = 'yellow' | 'red' | 'black';

export interface PenaltyEntryDraft {
  groupNumber: number;
  /**
   * Identifier of the rule within its group. Free-form alphanumeric +
   * hyphens / underscores to support rulebook codes like "R7a" or "B-12".
   * Server-side validator enforces `^[\w-]{1,20}$`.
   */
  refNumber: string;
  shortName: string;
  description: string;
  sanctions: PenaltyCard[];
}

interface Props {
  value: PenaltyEntryDraft[];
  disabled?: boolean;
  onChange: (entries: PenaltyEntryDraft[]) => void;
}

const CARD_ORDER: PenaltyCard[] = ['yellow', 'red', 'black'];

const CARD_CLASSES: Record<PenaltyCard, { active: string; inactive: string }> = {
  yellow: {
    active: 'bg-yellow-300 text-yellow-900 ring-yellow-500',
    inactive: 'bg-yellow-100/50 text-yellow-700/60',
  },
  red: {
    active: 'bg-red-500 text-white ring-red-700',
    inactive: 'bg-red-100/50 text-red-600/60',
  },
  black: {
    active: 'bg-slate-900 text-white ring-slate-900',
    inactive: 'bg-slate-300/40 text-slate-500/60',
  },
};

/**
 * Editable list of penalty ruleset entries, rendered as one collapsible
 * subsection per `groupNumber`. Drag-and-drop moves an entry between groups
 * (rewriting its `groupNumber`) or reorders within a group. Each row binds
 * to one `penalty_ruleset_entries` record. Sanctions are an ordered list
 * of card colours — the first item is what gets recorded on the first
 * offense, the second on the second offense, etc.
 *
 * Group labels (the free-text input next to "Group N") are visual-only
 * client state for this pass; the schema has no per-group label column.
 */
export function PenaltyEntriesEditor({ value, disabled, onChange }: Props) {
  const { t } = useI18n();
  // Visual-only labels, keyed by group number. Not persisted.
  const [groupLabels, setGroupLabels] = useState<Record<number, string>>({});
  const dragIndex = useRef<number | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);

  // Group entries by groupNumber, preserving array order within each group.
  const grouped = useMemo(() => {
    const map = new Map<number, { idx: number; entry: PenaltyEntryDraft }[]>();
    value.forEach((entry, idx) => {
      const list = map.get(entry.groupNumber) ?? [];
      list.push({ idx, entry });
      map.set(entry.groupNumber, list);
    });
    return [...map.entries()].sort(([a], [b]) => a - b);
  }, [value]);

  const knownGroups = useMemo(
    () => [...new Set(value.map((e) => e.groupNumber))].sort((a, b) => a - b),
    [value],
  );

  function update(index: number, patch: Partial<PenaltyEntryDraft>) {
    const next = value.slice();
    const existing = next[index];
    if (!existing) return;
    next[index] = { ...existing, ...patch };
    onChange(next);
  }

  function addRow(groupNumber: number) {
    if (disabled) return;
    onChange([
      ...value,
      {
        groupNumber,
        refNumber: String(value.length + 1),
        shortName: '',
        description: '',
        sanctions: ['yellow'],
      },
    ]);
  }

  function addGroup() {
    if (disabled) return;
    const next = knownGroups.length === 0 ? 1 : Math.max(...knownGroups) + 1;
    // Add a single empty row in the new group so the subsection shows up.
    addRow(next);
  }

  function removeRow(index: number) {
    if (disabled) return;
    onChange(value.filter((_, i) => i !== index));
  }

  function appendSanction(index: number, card: PenaltyCard) {
    const entry = value[index];
    if (!entry) return;
    update(index, { sanctions: [...entry.sanctions, card] });
  }

  function popSanction(index: number) {
    const entry = value[index];
    if (!entry || entry.sanctions.length === 0) return;
    update(index, { sanctions: entry.sanctions.slice(0, -1) });
  }

  // ── Drag-and-drop ──────────────────────────────────────────────────────
  // Source: the globally-indexed entry being dragged.
  // Target: either another row (re-order within or across groups) or a
  // group header (drop into that group at the end).

  function handleRowDragStart(globalIdx: number) {
    if (disabled) return;
    dragIndex.current = globalIdx;
    setDraggingIndex(globalIdx);
  }

  function handleRowDragOver(e: React.DragEvent, overGlobalIdx: number) {
    e.preventDefault();
    const from = dragIndex.current;
    if (from === null || from === overGlobalIdx) return;
    const next = value.slice();
    const movingEntry = next[from];
    const overEntry = next[overGlobalIdx];
    if (!movingEntry || !overEntry) return;
    // Adopt the over-row's group when crossing groups.
    const updatedMoving: PenaltyEntryDraft = {
      ...movingEntry,
      groupNumber: overEntry.groupNumber,
    };
    next.splice(from, 1);
    next.splice(overGlobalIdx, 0, updatedMoving);
    onChange(next);
    dragIndex.current = overGlobalIdx;
    setDraggingIndex(overGlobalIdx);
  }

  function handleGroupDrop(targetGroup: number) {
    const from = dragIndex.current;
    if (from === null) return;
    const next = value.slice();
    const moving = next[from];
    if (!moving) return;
    next[from] = { ...moving, groupNumber: targetGroup };
    onChange(next);
    dragIndex.current = null;
    setDraggingIndex(null);
  }

  function handleDragEnd() {
    dragIndex.current = null;
    setDraggingIndex(null);
  }

  return (
    <div className="space-y-4">
      {grouped.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-background px-4 py-6 text-center text-sm italic text-muted">
          {t('admin.penaltyRulesets.entriesEmpty')}
        </div>
      ) : (
        grouped.map(([groupNumber, rows]) => (
          <GroupSection
            key={groupNumber}
            groupNumber={groupNumber}
            rows={rows}
            disabled={disabled}
            label={groupLabels[groupNumber] ?? ''}
            onLabelChange={(label) => setGroupLabels((prev) => ({ ...prev, [groupNumber]: label }))}
            onAddRow={() => addRow(groupNumber)}
            onUpdate={update}
            onRemoveRow={removeRow}
            onAppendSanction={appendSanction}
            onPopSanction={popSanction}
            onRowDragStart={handleRowDragStart}
            onRowDragOver={handleRowDragOver}
            onGroupDrop={() => handleGroupDrop(groupNumber)}
            onDragEnd={handleDragEnd}
            draggingIndex={draggingIndex}
          />
        ))
      )}
      <div className="border-t border-border pt-3">
        <button
          type="button"
          onClick={addGroup}
          disabled={disabled}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground-secondary hover:bg-background disabled:opacity-50"
        >
          + {t('admin.penaltyRulesets.addGroup') || 'Add group'}
        </button>
      </div>
    </div>
  );
}

// ── Group subsection ────────────────────────────────────────────────────────

interface GroupSectionProps {
  groupNumber: number;
  rows: { idx: number; entry: PenaltyEntryDraft }[];
  disabled?: boolean;
  label: string;
  onLabelChange: (label: string) => void;
  onAddRow: () => void;
  onUpdate: (index: number, patch: Partial<PenaltyEntryDraft>) => void;
  onRemoveRow: (index: number) => void;
  onAppendSanction: (index: number, card: PenaltyCard) => void;
  onPopSanction: (index: number) => void;
  onRowDragStart: (globalIdx: number) => void;
  onRowDragOver: (e: React.DragEvent, overGlobalIdx: number) => void;
  onGroupDrop: () => void;
  onDragEnd: () => void;
  draggingIndex: number | null;
}

function GroupSection(props: GroupSectionProps) {
  const { t } = useI18n();
  const {
    groupNumber,
    rows,
    disabled,
    label,
    onLabelChange,
    onAddRow,
    onUpdate,
    onRemoveRow,
    onAppendSanction,
    onPopSanction,
    onRowDragStart,
    onRowDragOver,
    onGroupDrop,
    onDragEnd,
    draggingIndex,
  } = props;

  return (
    <section
      className="rounded-md border border-border bg-surface shadow-sm"
      onDragOver={(e) => e.preventDefault()}
      onDrop={onGroupDrop}
    >
      <header className="flex items-center gap-3 border-b border-border bg-background px-3 py-2">
        <span className="rounded bg-border px-2 py-0.5 text-xs font-mono font-semibold text-foreground-secondary">
          {t('admin.penaltyRulesets.groupHeader')?.replace('{n}', String(groupNumber)) ||
            `Group ${groupNumber}`}
        </span>
        <input
          type="text"
          value={label}
          disabled={disabled}
          onChange={(e) => onLabelChange(e.target.value)}
          placeholder={t('admin.penaltyRulesets.groupLabelPlaceholder') || 'Label (optional)'}
          className="flex-1 rounded-md border border-border px-2 py-1 text-sm disabled:bg-background"
        />
        <span className="text-xs text-muted">
          {rows.length} {rows.length === 1 ? 'entry' : 'entries'}
        </span>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-background/50 text-left text-xs font-semibold uppercase tracking-wider text-muted">
              <th className="w-8 px-2 py-2" aria-label={t('admin.srcComponents.dragHandle')} />
              <th className="w-24 px-3 py-2">{t('admin.penaltyRulesets.colRef')}</th>
              <th className="w-48 px-3 py-2">{t('admin.penaltyRulesets.colShortName')}</th>
              <th className="px-3 py-2">{t('admin.penaltyRulesets.colDescription')}</th>
              <th className="w-64 px-3 py-2">{t('admin.penaltyRulesets.colSanctions')}</th>
              <th className="w-12 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ idx, entry }) => (
              <PenaltyRow
                key={`${groupNumber}-${idx}`}
                globalIdx={idx}
                entry={entry}
                disabled={disabled}
                isDragging={draggingIndex === idx}
                onUpdate={(patch) => onUpdate(idx, patch)}
                onRemove={() => onRemoveRow(idx)}
                onAppendSanction={(card) => onAppendSanction(idx, card)}
                onPopSanction={() => onPopSanction(idx)}
                onDragStart={() => onRowDragStart(idx)}
                onDragOver={(e) => onRowDragOver(e, idx)}
                onDragEnd={onDragEnd}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="border-t border-border px-3 py-2">
        <button
          type="button"
          onClick={onAddRow}
          disabled={disabled}
          className="rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground-secondary hover:bg-background disabled:opacity-50"
        >
          + {t('admin.penaltyRulesets.addEntry')}
        </button>
      </div>
    </section>
  );
}

// ── Row ─────────────────────────────────────────────────────────────────────

interface RowProps {
  globalIdx: number;
  entry: PenaltyEntryDraft;
  disabled?: boolean;
  isDragging: boolean;
  onUpdate: (patch: Partial<PenaltyEntryDraft>) => void;
  onRemove: () => void;
  onAppendSanction: (card: PenaltyCard) => void;
  onPopSanction: () => void;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}

function PenaltyRow(props: RowProps) {
  const { t } = useI18n();
  const {
    entry,
    disabled,
    isDragging,
    onUpdate,
    onRemove,
    onAppendSanction,
    onPopSanction,
    onDragStart,
    onDragOver,
    onDragEnd,
  } = props;

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // Auto-grow textarea to fit content. Runs on every render with the
  // current value so reload-of-saved-multiline-content also expands.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [entry.description]);

  return (
    <tr
      draggable={!disabled}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      className={['border-b border-border last:border-b-0', isDragging ? 'opacity-40' : ''].join(
        ' ',
      )}
    >
      <td className="px-2 py-2 text-center text-muted cursor-grab active:cursor-grabbing select-none">
        ⠿
      </td>
      <td className="px-3 py-2">
        <input
          type="text"
          value={entry.refNumber}
          disabled={disabled}
          maxLength={20}
          onChange={(e) => onUpdate({ refNumber: e.target.value })}
          className="w-full rounded-md border border-border px-2 py-1 font-mono text-sm disabled:bg-background"
        />
      </td>
      <td className="px-3 py-2">
        <input
          type="text"
          value={entry.shortName}
          disabled={disabled}
          onChange={(e) => onUpdate({ shortName: e.target.value })}
          className="w-full rounded-md border border-border px-2 py-1 text-sm disabled:bg-background"
        />
      </td>
      <td className="px-3 py-2 align-top">
        <textarea
          ref={textareaRef}
          rows={1}
          value={entry.description}
          disabled={disabled}
          onChange={(e) => onUpdate({ description: e.target.value })}
          className="w-full resize-none overflow-hidden rounded-md border border-border px-2 py-1 text-sm leading-snug disabled:bg-background"
        />
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap items-center gap-1">
          {entry.sanctions.map((card, sIdx) => (
            <span
              key={sIdx}
              className={`inline-block h-5 w-3 rounded-sm ring-1 ${CARD_CLASSES[card].active}`}
              title={`#${sIdx + 1}: ${card}`}
            />
          ))}
          {entry.sanctions.length === 0 && (
            <span className="text-xs italic text-muted">
              {t('admin.penaltyRulesets.sanctionsEmpty')}
            </span>
          )}
          <div className="ml-2 flex gap-1">
            {CARD_ORDER.map((card) => (
              <button
                key={card}
                type="button"
                onClick={() => onAppendSanction(card)}
                disabled={disabled}
                className={`rounded px-1.5 py-0.5 text-xs font-mono ${CARD_CLASSES[card].active} hover:opacity-80 disabled:opacity-40`}
                title={t('admin.penaltyRulesets.appendSanction').replace('{card}', card)}
              >
                +{card.charAt(0).toUpperCase()}
              </button>
            ))}
            <button
              type="button"
              onClick={onPopSanction}
              disabled={disabled || entry.sanctions.length === 0}
              className="rounded border border-border px-1.5 py-0.5 text-xs text-foreground-secondary hover:bg-background disabled:opacity-40"
              title={t('admin.penaltyRulesets.popSanction')}
            >
              −
            </button>
          </div>
        </div>
      </td>
      <td className="px-2 py-2 text-center">
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          className="rounded p-1 text-muted hover:bg-danger/10 hover:text-danger disabled:opacity-40"
          title={t('admin.penaltyRulesets.removeEntry')}
        >
          ✕
        </button>
      </td>
    </tr>
  );
}
