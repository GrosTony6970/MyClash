'use client';

import { useEffect, useRef, useState } from 'react';
import type {
  BlockWarning,
  GenerateResult,
  ProgrammeBlock,
  ProgrammeSuggestion,
} from '@myclash/types';

const BLOCK_TYPE_ICONS: Record<string, string> = {
  admin: '📋',
  competition: '⚔️',
  workshop: '🎓',
  break: '☕',
};

const BLOCK_TYPE_COLORS: Record<string, string> = {
  admin: 'bg-purple-50 border-purple-200',
  competition: 'bg-blue-50 border-blue-200',
  workshop: 'bg-green-50 border-green-200',
  break: 'bg-gray-50 border-gray-200',
};

interface SuggestConfig {
  dayStartTime: string;
  dayEndTime: string;
  parallelLiceCount: number;
  matchDurationMinutes: number;
  matchGapSeconds: number;
  breakBetweenSessionsMinutes: number;
  middayBreakStart: string;
  middayBreakEnd: string;
  registrationDurationMinutes: number;
  gearCheckDurationMinutes: number;
  refereeMeetingDurationMinutes: number;
}

const DEFAULT_CONFIG: SuggestConfig = {
  dayStartTime: '08:00',
  dayEndTime: '19:00',
  parallelLiceCount: 3,
  matchDurationMinutes: 5,
  matchGapSeconds: 15,
  breakBetweenSessionsMinutes: 20,
  middayBreakStart: '12:00',
  middayBreakEnd: '13:00',
  registrationDurationMinutes: 60,
  gearCheckDurationMinutes: 30,
  refereeMeetingDurationMinutes: 30,
};

export function ProgrammePlanner({
  eventId,
  onGenerateDone,
}: {
  eventId: string;
  onGenerateDone: () => void;
}) {
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

  const [blocks, setBlocks] = useState<ProgrammeBlock[]>([]);
  const [warnings, setWarnings] = useState<BlockWarning[]>([]);
  const [config, setConfig] = useState<SuggestConfig>(DEFAULT_CONFIG);
  const [configOpen, setConfigOpen] = useState(false);
  const [activeDay, setActiveDay] = useState(0);
  const [loading, setLoading] = useState(true);
  const [suggesting, setSuggesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateResult, setGenerateResult] = useState<GenerateResult | null>(null);
  const [confirmGenerate, setConfirmGenerate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Drag state
  const dragIndex = useRef<number | null>(null);

  // Number of days from blocks
  const numDays = Math.max(1, ...blocks.map((b) => b.dayIndex + 1));
  const dayBlocks = blocks.filter((b) => b.dayIndex === activeDay);

  // ── Load saved blocks ──────────────────────────────────────────────────────

  useEffect(() => {
    fetch(`${apiUrl}/api/v1/events/${eventId}/programme`, { credentials: 'include' })
      .then(async (res) => {
        if (res.ok) setBlocks((await res.json()) as ProgrammeBlock[]);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [eventId, apiUrl]);

  // ── Auto-suggest ───────────────────────────────────────────────────────────

  async function suggest() {
    setSuggesting(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/programme/suggest`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? 'Failed to generate suggestion');
      }
      const suggestion = (await res.json()) as ProgrammeSuggestion;
      setBlocks(suggestion.blocks);
      setWarnings(suggestion.warnings);
      setActiveDay(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setSuggesting(false);
    }
  }

  // ── Save ───────────────────────────────────────────────────────────────────

  async function saveProgramme() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/programme`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocks }),
      });
      if (!res.ok) throw new Error('Failed to save');
      const saved = (await res.json()) as ProgrammeBlock[];
      setBlocks(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setSaving(false);
    }
  }

  // ── Generate ───────────────────────────────────────────────────────────────

  async function generate() {
    setGenerating(true);
    setConfirmGenerate(false);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/programme/generate`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to generate');
      const result = (await res.json()) as GenerateResult;
      setGenerateResult(result);
      setTimeout(() => onGenerateDone(), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setGenerating(false);
    }
  }

  // ── Block manipulation ─────────────────────────────────────────────────────

  function updateBlock(id: string, patch: Partial<ProgrammeBlock>) {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }

  function removeBlock(id: string) {
    setBlocks((prev) => prev.filter((b) => b.id !== id));
  }

  function applyWarning(blockId: string) {
    const w = warnings.find((w) => w.blockId === blockId);
    if (!w) return;
    updateBlock(blockId, { endTime: w.suggestedEndTime });
    setWarnings((prev) => prev.filter((x) => x.blockId !== blockId));
  }

  function dismissWarning(blockId: string) {
    setWarnings((prev) => prev.filter((x) => x.blockId !== blockId));
  }

  // Drag-drop reorder within current day
  function handleDragStart(idx: number) {
    dragIndex.current = idx;
  }

  function handleDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault();
    const from = dragIndex.current;
    if (from === null || from === idx) return;

    const dayBlockIds = dayBlocks.map((b) => b.id);
    const allBlocks = [...blocks];

    // Find global indices
    const fromId = dayBlockIds[from]!;
    const toId = dayBlockIds[idx]!;
    const fromGlobal = allBlocks.findIndex((b) => b.id === fromId);
    const toGlobal = allBlocks.findIndex((b) => b.id === toId);

    if (fromGlobal === -1 || toGlobal === -1) return;

    const [removed] = allBlocks.splice(fromGlobal, 1);
    allBlocks.splice(toGlobal, 0, removed!);
    setBlocks(allBlocks.map((b, i) => ({ ...b, sortOrder: i })));
    dragIndex.current = idx;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <span className="w-8 h-8 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      {/* Config bar */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl mb-4">
        <button
          onClick={() => setConfigOpen((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700"
        >
          <span>Configuration</span>
          <span className="text-gray-400">{configOpen ? '▲' : '▼'}</span>
        </button>
        {configOpen && (
          <div className="px-4 pb-4 grid grid-cols-2 gap-3 text-sm border-t border-gray-200 pt-3">
            {(
              [
                ['Day start', 'dayStartTime', 'time'],
                ['Day end', 'dayEndTime', 'time'],
                ['Parallel lices', 'parallelLiceCount', 'number'],
                ['Match duration (min)', 'matchDurationMinutes', 'number'],
                ['Match gap (sec)', 'matchGapSeconds', 'number'],
                ['Break between sessions (min)', 'breakBetweenSessionsMinutes', 'number'],
                ['Midday break start', 'middayBreakStart', 'time'],
                ['Midday break end', 'middayBreakEnd', 'time'],
                ['Registration (min)', 'registrationDurationMinutes', 'number'],
                ['Gear check (min)', 'gearCheckDurationMinutes', 'number'],
                ['Referee meeting (min)', 'refereeMeetingDurationMinutes', 'number'],
              ] as [string, keyof SuggestConfig, string][]
            ).map(([label, key, type]) => (
              <label key={key} className="flex flex-col gap-1">
                <span className="text-xs text-gray-500">{label}</span>
                <input
                  type={type}
                  value={config[key]}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      [key]: type === 'number' ? Number(e.target.value) : e.target.value,
                    }))
                  }
                  className="border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                />
              </label>
            ))}
            <div className="col-span-2 flex justify-end">
              <button
                onClick={() => void suggest()}
                disabled={suggesting}
                className="bg-red-700 hover:bg-red-800 disabled:opacity-50 text-white font-semibold py-2 px-4 rounded-md text-sm"
              >
                {suggesting ? 'Generating…' : '✦ Auto-suggest'}
              </button>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm mb-4">
          {error}
        </div>
      )}

      {generateResult && (
        <div className="bg-green-50 border border-green-200 text-green-700 rounded-lg px-4 py-3 text-sm mb-4">
          Generated {generateResult.matchesScheduled} matches and{' '}
          {generateResult.workshopSessionsCreated} workshop sessions. Redirecting to grid…
        </div>
      )}

      {/* Day tabs */}
      {numDays > 1 && (
        <div className="flex gap-1 mb-4">
          {Array.from({ length: numDays }, (_, i) => (
            <button
              key={i}
              onClick={() => setActiveDay(i)}
              className={[
                'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                activeDay === i
                  ? 'bg-red-700 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
              ].join(' ')}
            >
              Day {i + 1}
            </button>
          ))}
        </div>
      )}

      {/* Block list */}
      {dayBlocks.length === 0 ? (
        <div className="bg-blue-50 border border-blue-200 text-blue-700 rounded-lg px-4 py-3 text-sm mb-4">
          No blocks for this day. Use Auto-suggest or add blocks manually.
        </div>
      ) : (
        <div className="flex flex-col gap-1.5 mb-4">
          {dayBlocks.map((block, idx) => {
            const warning = warnings.find((w) => w.blockId === block.id);
            return (
              <BlockRow
                key={block.id}
                block={block}
                warning={warning}
                dragging={dragIndex.current === idx}
                onDragStart={() => handleDragStart(idx)}
                onDragOver={(e) => handleDragOver(e, idx)}
                onDragEnd={() => {
                  dragIndex.current = null;
                }}
                onChange={(patch) => updateBlock(block.id, patch)}
                onRemove={() => removeBlock(block.id)}
                onApplyWarning={() => applyWarning(block.id)}
                onDismissWarning={() => dismissWarning(block.id)}
              />
            );
          })}
        </div>
      )}

      {/* Action bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={() => void suggest()}
          disabled={suggesting}
          className="text-sm text-red-700 hover:underline disabled:opacity-50"
        >
          {suggesting ? 'Generating…' : '✦ Auto-suggest'}
        </button>
        <button
          onClick={() => void saveProgramme()}
          disabled={saving || blocks.length === 0}
          className="border border-gray-300 rounded-md px-4 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save programme'}
        </button>
        <button
          onClick={() => setConfirmGenerate(true)}
          disabled={generating || blocks.length === 0}
          className="bg-red-700 hover:bg-red-800 disabled:opacity-50 text-white font-semibold py-2 px-4 rounded-md text-sm"
        >
          {generating ? 'Generating…' : 'Generate schedule →'}
        </button>
      </div>

      {/* Confirm generate modal */}
      {confirmGenerate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-sm w-full mx-4 shadow-xl">
            <h2 className="text-lg font-bold mb-2">Generate schedule?</h2>
            <p className="text-sm text-gray-600 mb-4">
              This will assign match start times and lices, and create workshop sessions based on
              the saved programme. Existing scheduled matches will be overwritten.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmGenerate(false)}
                className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void generate()}
                className="px-4 py-2 text-sm bg-red-700 text-white rounded-md hover:bg-red-800 font-semibold"
              >
                Generate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── BlockRow ──────────────────────────────────────────────────────────────────

function BlockRow({
  block,
  warning,
  dragging,
  onDragStart,
  onDragOver,
  onDragEnd,
  onChange,
  onRemove,
  onApplyWarning,
  onDismissWarning,
}: {
  block: ProgrammeBlock;
  warning?: BlockWarning;
  dragging: boolean;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onChange: (patch: Partial<ProgrammeBlock>) => void;
  onRemove: () => void;
  onApplyWarning: () => void;
  onDismissWarning: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      className={[
        'border rounded-xl transition-opacity',
        BLOCK_TYPE_COLORS[block.blockType] ?? 'bg-gray-50 border-gray-200',
        dragging ? 'opacity-40' : '',
      ].join(' ')}
    >
      {/* Main row */}
      <div className="flex items-center gap-3 px-3 py-2.5">
        {/* Drag handle */}
        <span className="text-gray-300 cursor-grab active:cursor-grabbing text-lg leading-none select-none">
          ⠿
        </span>

        {/* Icon */}
        <span className="text-base leading-none">{BLOCK_TYPE_ICONS[block.blockType] ?? '📌'}</span>

        {/* Times */}
        <div className="flex items-center gap-1 text-xs text-gray-500 font-mono flex-shrink-0">
          <input
            type="time"
            value={block.startTime}
            onChange={(e) => onChange({ startTime: e.target.value })}
            className="border-0 bg-transparent text-xs font-mono w-16 focus:outline-none focus:ring-1 focus:ring-red-600 rounded"
          />
          <span>–</span>
          <input
            type="time"
            value={block.endTime}
            onChange={(e) => onChange({ endTime: e.target.value })}
            className="border-0 bg-transparent text-xs font-mono w-16 focus:outline-none focus:ring-1 focus:ring-red-600 rounded"
          />
        </div>

        {/* Label */}
        <span className="flex-1 text-sm font-medium text-gray-800 truncate">{block.label}</span>

        {/* Lice badge */}
        {block.liceCount > 0 && (
          <span className="text-xs bg-white border border-gray-200 rounded-full px-2 py-0.5 text-gray-500 flex-shrink-0">
            {block.liceCount} lice{block.liceCount !== 1 ? 's' : ''}
          </span>
        )}

        {/* Warning badge */}
        {warning && (
          <span className="text-xs bg-amber-100 border border-amber-300 text-amber-700 rounded-full px-2 py-0.5 flex-shrink-0">
            ⚠ +{warning.overflowMinutes}min
          </span>
        )}

        {/* Expand / remove */}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-gray-400 hover:text-gray-600 text-xs px-1"
        >
          {expanded ? '▲' : '▾'}
        </button>
        <button onClick={onRemove} className="text-gray-300 hover:text-red-500 text-xs px-1">
          ✕
        </button>
      </div>

      {/* Warning actions */}
      {warning && (
        <div className="px-10 pb-2 flex items-center gap-3 text-xs text-amber-700">
          <span>{warning.message}.</span>
          <button onClick={onApplyWarning} className="underline hover:no-underline">
            Suggest fit ({warning.suggestedEndTime})
          </button>
          <button onClick={onDismissWarning} className="text-gray-400 hover:text-gray-600">
            Override
          </button>
        </div>
      )}

      {/* Expanded details */}
      {expanded && (
        <div className="px-10 pb-3 grid grid-cols-2 gap-2 text-xs border-t border-current border-opacity-10 pt-2">
          {block.blockType === 'competition' && (
            <>
              <label className="flex flex-col gap-0.5">
                <span className="text-gray-500">Lices</span>
                <input
                  type="number"
                  min={1}
                  value={block.liceCount}
                  onChange={(e) => onChange({ liceCount: Number(e.target.value) })}
                  className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-red-600 w-20"
                />
              </label>
              <label className="flex flex-col gap-0.5">
                <span className="text-gray-500">Match duration (min)</span>
                <input
                  type="number"
                  min={1}
                  value={block.matchDurationMinutes}
                  onChange={(e) => onChange({ matchDurationMinutes: Number(e.target.value) })}
                  className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-red-600 w-20"
                />
              </label>
              <label className="flex flex-col gap-0.5">
                <span className="text-gray-500">Match gap (sec)</span>
                <input
                  type="number"
                  min={0}
                  value={block.matchGapSeconds}
                  onChange={(e) => onChange({ matchGapSeconds: Number(e.target.value) })}
                  className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-red-600 w-20"
                />
              </label>
            </>
          )}
          <label className="flex flex-col gap-0.5 col-span-2">
            <span className="text-gray-500">Label</span>
            <input
              type="text"
              value={block.label}
              onChange={(e) => onChange({ label: e.target.value })}
              className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-red-600"
            />
          </label>
        </div>
      )}
    </div>
  );
}
