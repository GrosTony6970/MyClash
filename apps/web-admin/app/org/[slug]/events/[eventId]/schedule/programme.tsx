'use client';

/* eslint-disable myclash/no-literal-string */

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

// `parallelLiceCount: 0` is a sentinel — replaced at load time with the
// actual number of lices configured for the event (run all in parallel).
const DEFAULT_CONFIG: SuggestConfig = {
  dayStartTime: '08:00',
  dayEndTime: '19:00',
  parallelLiceCount: 0,
  matchDurationMinutes: 5,
  matchGapSeconds: 10,
  breakBetweenSessionsMinutes: 10,
  middayBreakStart: '12:00',
  middayBreakEnd: '13:00',
  registrationDurationMinutes: 60,
  gearCheckDurationMinutes: 30,
  refereeMeetingDurationMinutes: 30,
};

export function ProgrammePlanner({
  eventId,
  onGenerateDone,
  topSuggestNonce,
  generateScheduleLabel,
  generateGridLabel,
}: {
  eventId: string;
  onGenerateDone: () => void;
  /**
   * When this number changes, the planner runs `suggest()`. Lets the
   * merged page expose a "Generate schedule" button in its top header
   * without lifting the entire config state out of this component.
   * Increment the nonce from the parent on click.
   */
  topSuggestNonce?: number;
  /** Localised button labels — fall back to English defaults if unset. */
  generateScheduleLabel?: string;
  generateGridLabel?: string;
}) {
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

  const [blocks, setBlocks] = useState<ProgrammeBlock[]>([]);
  const [warnings, setWarnings] = useState<BlockWarning[]>([]);
  const [config, setConfig] = useState<SuggestConfig>(DEFAULT_CONFIG);
  const [activeDay, setActiveDay] = useState(0);
  const [loading, setLoading] = useState(true);
  const [suggesting, setSuggesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateResult, setGenerateResult] = useState<GenerateResult | null>(null);
  const [confirmGenerate, setConfirmGenerate] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);

  // Drag state
  const dragIndex = useRef<number | null>(null);

  // Number of days from blocks
  const numDays = Math.max(1, ...blocks.map((b) => b.dayIndex + 1));
  const dayBlocks = blocks.filter((b) => b.dayIndex === activeDay);

  // ── Load saved blocks + default parallel-lice count ───────────────────────

  useEffect(() => {
    fetch(`${apiUrl}/api/v1/events/${eventId}/programme`, { credentials: 'include' })
      .then(async (res) => {
        if (res.ok) setBlocks((await res.json()) as ProgrammeBlock[]);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));

    // Default parallelLiceCount = number of lices configured for the event.
    // Only set if user hasn't already overridden the sentinel (0).
    fetch(`${apiUrl}/api/v1/events/${eventId}/lices`, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) return;
        const lices = (await res.json()) as Array<{ id: string }>;
        const count = Math.max(1, lices.length);
        setConfig((prev) =>
          prev.parallelLiceCount === 0 ? { ...prev, parallelLiceCount: count } : prev,
        );
      })
      .catch(() => undefined);
  }, [eventId, apiUrl]);

  // Top "Generate schedule" button lives in the page header; clicking
  // it bumps `topSuggestNonce` and we re-run suggest here. Skip the
  // initial render (nonce === undefined) so we don't generate on mount.
  const firstNonceRef = useRef(true);
  useEffect(() => {
    if (topSuggestNonce === undefined) return;
    if (firstNonceRef.current) {
      firstNonceRef.current = false;
      return;
    }
    void suggest();
    // suggest is intentionally not a dependency — defining it inside the
    // component changes identity on every render; we just want the nonce
    // to drive a single call per click.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topSuggestNonce]);

  // ── Auto-suggest ───────────────────────────────────────────────────────────

  async function suggest() {
    setSuggesting(true);
    setError(null);
    try {
      const payload: SuggestConfig = {
        ...config,
        // DTO requires >= 1; if the sentinel is still in place, fall back to 1.
        parallelLiceCount: Math.max(1, config.parallelLiceCount),
      };
      const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/programme/suggest`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? 'Failed to generate suggestion');
      }
      const suggestion = (await res.json()) as ProgrammeSuggestion;
      // Auto-save: every suggestion overwrites whatever was in
      // place before, so persist immediately. Operators no longer
      // need a second click on "Save programme" to make a fresh
      // suggestion survive a refresh.
      const saved = await persistProgramme(suggestion.blocks);
      setBlocks(saved);
      setWarnings(suggestion.warnings);
      setActiveDay(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setSuggesting(false);
    }
  }

  // ── Save ───────────────────────────────────────────────────────────────────

  async function readErrorMessage(res: Response, fallback: string): Promise<string> {
    try {
      const body = (await res.json()) as { message?: string | string[]; error?: string };
      if (Array.isArray(body.message)) return body.message.join(', ');
      return body.message ?? body.error ?? fallback;
    } catch {
      return fallback;
    }
  }

  async function persistProgramme(blocksOverride?: ProgrammeBlock[]): Promise<ProgrammeBlock[]> {
    // Backend DTO whitelists fields with forbidNonWhitelisted; drop
    // server-only fields (eventId, generatedAt) before sending.
    // Accepts an explicit blocks list so callers that just received
    // a fresh suggestion can persist it without waiting for setBlocks
    // to flush through React's render cycle.
    const source = blocksOverride ?? blocks;
    const payloadBlocks = source.map((b) => ({
      id: b.id,
      dayIndex: b.dayIndex,
      sortOrder: b.sortOrder,
      blockType: b.blockType,
      label: b.label,
      competitionId: b.competitionId,
      competitionPhase: b.competitionPhase,
      workshopId: b.workshopId,
      liceCount: b.liceCount,
      startTime: b.startTime,
      endTime: b.endTime,
      matchGapSeconds: b.matchGapSeconds,
      matchDurationMinutes: b.matchDurationMinutes,
    }));
    const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/programme`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blocks: payloadBlocks }),
    });
    if (!res.ok) throw new Error(await readErrorMessage(res, 'Failed to save'));
    return (await res.json()) as ProgrammeBlock[];
  }

  async function saveProgramme() {
    setSaving(true);
    setError(null);
    try {
      const saved = await persistProgramme();
      setBlocks(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setSaving(false);
    }
  }

  // ── Reset ──────────────────────────────────────────────────────────────────

  /**
   * Nuclear reset: drop every programme block AND clear every
   * scheduled match time + lice assignment in the event. Tournaments,
   * pools, brackets stay; only their schedule is erased.
   */
  async function resetSchedule() {
    setResetting(true);
    setConfirmReset(false);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/programme/full`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await readErrorMessage(res, 'Failed to reset'));
      setBlocks([]);
      setWarnings([]);
      setGenerateResult(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setResetting(false);
    }
  }

  // ── Generate ───────────────────────────────────────────────────────────────

  async function generate() {
    setGenerating(true);
    setConfirmGenerate(false);
    setError(null);
    try {
      const saved = await persistProgramme();
      setBlocks(saved);
      const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/programme/generate`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await readErrorMessage(res, 'Failed to generate'));
      const result = (await res.json()) as GenerateResult;
      setGenerateResult(result);
      // Only switch to the grid when matches actually landed there.
      // When 0 matches got scheduled the operator needs to read the
      // per-block diagnostics, not be teleported to an empty grid.
      if (result.matchesScheduled > 0) {
        setTimeout(() => onGenerateDone(), 1500);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setGenerating(false);
    }
  }

  // ── Block manipulation ─────────────────────────────────────────────────────

  /**
   * Append a blank block to the active day. Operator fills it in via
   * the existing inline editors (BlockRow) and persists with "Save
   * programme" — same code path as auto-suggested blocks. Defaults to
   * an admin block since that's the only type that doesn't require
   * picking a linked competition/workshop up front.
   */
  function addBlock() {
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const sortOrder = blocks.filter((b) => b.dayIndex === activeDay).length;
    const newBlock: ProgrammeBlock = {
      id,
      eventId,
      dayIndex: activeDay,
      sortOrder,
      blockType: 'admin',
      label: '',
      competitionId: null,
      competitionPhase: null,
      workshopId: null,
      liceCount: 0,
      startTime: '08:00',
      endTime: '08:30',
      matchGapSeconds: 0,
      matchDurationMinutes: 0,
      generatedAt: null,
    };
    setBlocks((prev) => [...prev, newBlock]);
  }

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
    setDraggingIndex(idx);
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
    setDraggingIndex(idx);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <span className="w-8 h-8 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      {/* Slice 8: Configuration sidebar — fixed 280 px sticky column on
          lg+, stacks above the preview on smaller viewports. The Suggest
          button stays inside the sidebar so operators don't have to
          hunt for it after tweaking values. */}
      <aside className="lg:sticky lg:top-6 lg:self-start space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Configuration
        </h2>
        <div className="grid grid-cols-1 gap-3">
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
          ).map(([label, key, type]) => {
            // Slice A of the schedule overhaul: 'time' fields use a
            // custom HH:MM text input instead of <input type="time">.
            // Native time pickers defer to the user's browser/OS
            // locale — en-US users see AM/PM. The text input keeps
            // the picker UX simple ("type the time") and the value
            // shape is identical (HH:MM strings, what SuggestConfig
            // already stores). Numeric pattern blocks junk input.
            const isTime = type === 'time';
            return (
              <label key={key} className="flex flex-col gap-1">
                <span className="text-xs text-slate-500">{label}</span>
                <input
                  type={isTime ? 'text' : type}
                  inputMode={isTime ? 'numeric' : undefined}
                  pattern={isTime ? '^([01]?[0-9]|2[0-3]):[0-5][0-9]$' : undefined}
                  placeholder={isTime ? 'HH:MM' : undefined}
                  maxLength={isTime ? 5 : undefined}
                  value={config[key]}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      [key]: type === 'number' ? Number(e.target.value) : e.target.value,
                    }))
                  }
                  className="border border-slate-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                />
              </label>
            );
          })}
        </div>
        <button
          onClick={() => void suggest()}
          disabled={suggesting}
          className="w-full bg-red-700 hover:bg-red-800 disabled:opacity-50 text-white font-semibold py-2 px-4 rounded-md text-sm"
        >
          {suggesting ? 'Generating…' : `✦ ${generateScheduleLabel ?? 'Generate schedule'}`}
        </button>
      </aside>

      {/* Preview / output column. */}
      <div className="min-w-0 space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm mb-4">
            {error}
          </div>
        )}

        {generateResult && (
          <div
            className={[
              'rounded-lg px-4 py-3 text-sm mb-4 border',
              generateResult.matchesScheduled > 0
                ? 'bg-green-50 border-green-200 text-green-800'
                : 'bg-amber-50 border-amber-200 text-amber-900',
            ].join(' ')}
          >
            <div className="font-semibold">
              Generated {generateResult.matchesScheduled} matches and{' '}
              {generateResult.workshopSessionsCreated} workshop sessions.
            </div>
            {generateResult.matchesScheduled === 0 && (
              <div className="mt-1">
                Nothing landed on the grid. Per-block status below — fix the flagged blocks and try
                again.
              </div>
            )}
            {generateResult.blockDiagnostics && generateResult.blockDiagnostics.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-xs">
                {generateResult.blockDiagnostics.map((d) => {
                  const ok = d.scheduledMatches > 0;
                  const empty = d.fetchedMatches === 0;
                  const noLices = d.licesAvailable === 0;
                  return (
                    <li key={d.blockId}>
                      <span className="font-mono">
                        {ok ? '✓' : empty ? '∅' : noLices ? '⚠' : '×'}
                      </span>{' '}
                      <span className="font-medium">{d.blockLabel}</span>
                      {' — '}
                      {d.scheduledMatches}/{d.fetchedMatches} scheduled on {d.licesAvailable} lice
                      {empty && ' · no matches in this competition — has the draw run?'}
                      {noLices && !empty && ' · block requested 0 lices'}
                    </li>
                  );
                })}
              </ul>
            )}
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
            No blocks for this day. Use Generate schedule or add blocks manually.
          </div>
        ) : (
          <div className="flex flex-col gap-1.5 mb-2">
            {dayBlocks.map((block, idx) => {
              const warning = warnings.find((w) => w.blockId === block.id);
              return (
                <BlockRow
                  key={block.id}
                  block={block}
                  warning={warning}
                  dragging={draggingIndex === idx}
                  onDragStart={() => handleDragStart(idx)}
                  onDragOver={(e) => handleDragOver(e, idx)}
                  onDragEnd={() => {
                    dragIndex.current = null;
                    setDraggingIndex(null);
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

        {/* Slice B: manual block add — appended in component state,
            persisted on next "Save programme". */}
        <button
          type="button"
          onClick={addBlock}
          className="mb-4 inline-flex items-center gap-1 rounded-md border border-dashed border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-slate-400 hover:text-slate-900"
        >
          + Add block
        </button>

        {/* Action bar */}
        <div className="flex items-center gap-3 flex-wrap">
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
            {generating ? 'Generating…' : `${generateGridLabel ?? 'Generate Grid'} →`}
          </button>
          <button
            onClick={() => setConfirmReset(true)}
            disabled={resetting}
            className="ml-auto rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
            title="Wipe the programme + clear every scheduled match"
          >
            {resetting ? 'Resetting…' : 'Reset schedule'}
          </button>
        </div>
      </div>

      {/* Confirm reset modal */}
      {confirmReset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="mx-4 w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h2 className="mb-2 text-lg font-bold">Reset the schedule?</h2>
            <p className="mb-4 text-sm text-gray-600">
              This clears every programme block AND removes every match from the lice grid. The
              tournaments, pools, and brackets themselves stay — only their schedule is erased.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmReset(false)}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void resetSchedule()}
                className="rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800"
              >
                Reset everything
              </button>
            </div>
          </div>
        </div>
      )}

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
