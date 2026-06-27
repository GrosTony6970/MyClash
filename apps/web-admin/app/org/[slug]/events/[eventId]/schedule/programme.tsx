'use client';

/* eslint-disable myclash/no-literal-string */

import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  BlockWarning,
  GenerateResult,
  ProgrammeBlock,
  ProgrammeSuggestion,
} from '@myclash/types';
import { useConfirm } from '@myclash/ui';
import { minToTime, nextBlockStartTime, resequenceDay, timeToMin } from './programme-timeline';
import { blockTint } from './block-tint';
import { ColorSwatchPicker } from '@/components/ColorSwatchPicker';

// Workshops are managed on the dedicated workshop board, not the event
// programme — no 'workshop' entry here (any legacy rows are filtered out).
const BLOCK_TYPE_ICONS: Record<string, string> = {
  admin: '📋',
  competition: '⚔️',
  break: '☕',
};

const BLOCK_TYPE_COLORS: Record<string, string> = {
  admin: 'bg-purple-50 border-purple-200',
  competition: 'bg-blue-50 border-blue-200',
  break: 'bg-gray-50 border-gray-200',
};

interface SuggestConfig {
  dayStartTime: string;
  dayEndTime: string;
  parallelLiceCount: number;
  matchDurationMinutes: number;
  matchGapSeconds: number;
  minRestMinutes: number;
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
  minRestMinutes: 10,
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
  onBlocksChanged,
  topSuggestNonce,
  programmeRefreshKey,
  generateScheduleLabel,
  generateGridLabel,
}: {
  eventId: string;
  /**
   * Fired after a successful Generate Grid run. Receives the
   * GenerateResult so the page can surface a toast above the grid
   * (replaces the inline result banner this component used to show).
   */
  onGenerateDone: (result: GenerateResult) => void;
  /**
   * Fired after any persisted change to programme blocks or scheduled
   * matches that the grid should re-fetch — Save, Reset, and the
   * "Generate produced 0 matches" branch (where blocks were re-saved
   * and existing matches wiped but no toast fires). The page wires
   * this to bump the grid's mount key so the grid re-reads the new
   * state instead of going stale.
   */
  onBlocksChanged?: () => void;
  /**
   * When this number changes, the planner runs `suggest()`. Lets the
   * page expose a "Generate schedule" button without lifting the
   * entire config state out of this component. Increment the nonce
   * from the parent on click.
   */
  topSuggestNonce?: number;
  /**
   * When this number changes, the planner re-runs its block-list
   * mount fetch. Symmetric to onBlocksChanged → gridRefreshKey: the
   * page bumps this whenever the grid mutates a block (inline ×
   * delete, drag-move) so the drawer stays in sync without the
   * operator closing + re-opening it.
   */
  programmeRefreshKey?: number;
  /** Localised button labels — fall back to English defaults if unset. */
  generateScheduleLabel?: string;
  generateGridLabel?: string;
}) {
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
  const { confirm, confirmDialog } = useConfirm();

  const [blocks, setBlocks] = useState<ProgrammeBlock[]>([]);
  const [warnings, setWarnings] = useState<BlockWarning[]>([]);
  const [config, setConfig] = useState<SuggestConfig>(DEFAULT_CONFIG);
  const [activeDay, setActiveDay] = useState(0);
  const [loading, setLoading] = useState(true);
  const [suggesting, setSuggesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateResult, setGenerateResult] = useState<GenerateResult | null>(null);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  // Day multi-select for Generate: distinct days present in the blocks; the
  // operator unticks days to leave them untouched. `skipDays` = unticked.
  const distinctDays = useMemo(
    () => [...new Set(blocks.map((b) => b.dayIndex))].sort((a, b) => a - b),
    [blocks],
  );
  const [skipDays, setSkipDays] = useState<Set<number>>(new Set());

  // Drag state
  const dragIndex = useRef<number | null>(null);

  // Number of days from blocks
  const numDays = Math.max(1, ...blocks.map((b) => b.dayIndex + 1));
  // Workshops live on their own board — never list legacy workshop blocks here.
  const dayBlocks = blocks.filter((b) => b.dayIndex === activeDay && b.blockType !== 'workshop');

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
    // The lices fetch deliberately stays outside the refresh nonce —
    // the grid can't change the lice list.
  }, [eventId, apiUrl, programmeRefreshKey]);

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
      minRestMinutes: b.minRestMinutes,
      colorHex: b.colorHex ?? null,
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
      onBlocksChanged?.();
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
  async function confirmAndReset() {
    const ok = await confirm({
      title: 'Reset the schedule?',
      description:
        'This clears every programme block AND removes every match from the lice grid. The tournaments, pools, and brackets themselves stay — only their schedule is erased.',
      confirmLabel: 'Reset everything',
      danger: true,
    });
    if (ok) await resetSchedule();
  }

  async function resetSchedule() {
    setResetting(true);
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
      onBlocksChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setResetting(false);
    }
  }

  // ── Generate ───────────────────────────────────────────────────────────────

  async function confirmAndGenerate() {
    const ok = await confirm({
      title: 'Generate schedule?',
      description:
        'This will assign match start times and lices based on the saved programme. Existing scheduled matches will be overwritten.',
      confirmLabel: 'Generate',
    });
    if (ok) await generate();
  }

  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      const saved = await persistProgramme();
      setBlocks(saved);
      // Scope generation to the ticked days; omit the body to mean "all days".
      const dayIndices = distinctDays.filter((d) => !skipDays.has(d));
      const scoped = dayIndices.length > 0 && dayIndices.length < distinctDays.length;
      const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/programme/generate`, {
        method: 'POST',
        credentials: 'include',
        ...(scoped
          ? {
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ dayIndices }),
            }
          : {}),
      });
      if (!res.ok) throw new Error(await readErrorMessage(res, 'Failed to generate'));
      const result = (await res.json()) as GenerateResult;
      // Generation packs the day sequentially, so it may have shifted
      // admin/break/competition block times to remove overlaps. Re-fetch the
      // programme so the drawer list mirrors the persisted times instead of the
      // pre-generate ones (the grid already re-fetches via its refresh key).
      try {
        const refreshed = await fetch(`${apiUrl}/api/v1/events/${eventId}/programme`, {
          credentials: 'include',
        });
        if (refreshed.ok) setBlocks((await refreshed.json()) as ProgrammeBlock[]);
      } catch {
        // Non-fatal — the list catches up on next drawer open.
      }
      // When 0 matches landed (e.g. no lices, no draw run), keep the
      // result on-screen here so the operator can read per-block
      // diagnostics. Only bubble up the success → drawer auto-close
      // + page toast when something actually shipped. Either way the
      // backend wiped existing scheduled matches before re-attempting,
      // so the grid needs to re-fetch.
      if (result.matchesScheduled > 0) {
        onGenerateDone(result);
      } else {
        setGenerateResult(result);
        onBlocksChanged?.();
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
    // Continue right after the day's last block (30-min default span) rather
    // than always jumping back to the day start.
    const startTime = nextBlockStartTime(blocks, activeDay, config.dayStartTime);
    const endTime = minToTime(timeToMin(startTime) + 30);
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
      startTime,
      endTime,
      matchGapSeconds: 0,
      matchDurationMinutes: 0,
      minRestMinutes: 10,
      colorHex: null,
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
    // Reindex sortOrder, then re-flow the active day's times so the blocks
    // run back-to-back in the new order (durations preserved).
    const reordered = allBlocks.map((b, i) => ({ ...b, sortOrder: i }));
    setBlocks(resequenceDay(reordered, activeDay, config.dayStartTime));
    dragIndex.current = idx;
    setDraggingIndex(idx);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <span className="w-8 h-8 border-2 border-border border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Configuration sidebar stacks above the day blocks inside the
          drawer. Tailwind responsive prefixes (lg:) are viewport, not
          container — when this lived in a 2-col split it crushed the
          day-blocks column to ~140 px and cropped block cards on the
          grid behind. Stacking matches the operator's workflow: set
          knobs once, edit blocks 90 % of the time. */}
      <aside className="space-y-3 rounded-xl border border-border bg-surface p-4 text-sm">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Configuration</h2>
        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          {(
            [
              ['Day start', 'dayStartTime', 'time'],
              ['Day end', 'dayEndTime', 'time'],
              ['Parallel lices', 'parallelLiceCount', 'number'],
              ['Match duration (min)', 'matchDurationMinutes', 'number'],
              ['Match gap (sec)', 'matchGapSeconds', 'number'],
              ['Min rest / fighter (min)', 'minRestMinutes', 'number'],
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
                <span className="text-xs text-muted">{label}</span>
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
                  className="border border-border rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </label>
            );
          })}
        </div>
        <button
          onClick={() => void suggest()}
          data-testid="schedule-suggest"
          disabled={suggesting}
          className="w-full bg-accent hover:bg-accent-hover disabled:opacity-50 text-accent-foreground font-semibold py-2 px-4 rounded-md text-sm"
        >
          {suggesting ? 'Generating…' : `✦ ${generateScheduleLabel ?? 'Generate schedule'}`}
        </button>
      </aside>

      {/* Preview / output column. */}
      <div className="min-w-0 space-y-4">
        {error && (
          <div className="bg-danger/10 border border-danger/30 text-danger rounded-lg px-4 py-3 text-sm mb-4">
            {error}
          </div>
        )}

        {generateResult && (
          <div
            className={[
              'rounded-lg px-4 py-3 text-sm mb-4 border',
              generateResult.matchesScheduled > 0
                ? 'bg-success/10 border-success/30 text-success'
                : 'bg-warning/10 border-warning/30 text-warning',
            ].join(' ')}
          >
            <div className="font-semibold">
              Generated {generateResult.matchesScheduled} matches.
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
                    ? 'bg-accent text-accent-foreground'
                    : 'text-foreground-secondary hover:bg-border',
                ].join(' ')}
              >
                Day {i + 1}
              </button>
            ))}
          </div>
        )}

        {/* Block list */}
        {dayBlocks.length === 0 ? (
          <div className="bg-info/10 border border-info/30 text-info rounded-lg px-4 py-3 text-sm mb-4">
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
          className="mb-4 inline-flex items-center gap-1 rounded-md border border-dashed border-border px-3 py-1.5 text-xs font-medium text-foreground-secondary hover:border-muted hover:text-foreground"
        >
          + Add block
        </button>

        {/* Day multi-select — which days Generate (re)builds. Only shown
            for multi-day programmes; unticked days are left untouched. */}
        {distinctDays.length > 1 && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-background px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">
              Generate days
            </span>
            {distinctDays.map((d) => {
              const checked = !skipDays.has(d);
              return (
                <label
                  key={d}
                  className="flex items-center gap-1 text-sm text-foreground-secondary"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() =>
                      setSkipDays((prev) => {
                        const next = new Set(prev);
                        if (checked) next.add(d);
                        else next.delete(d);
                        return next;
                      })
                    }
                  />
                  Day {d + 1}
                </label>
              );
            })}
          </div>
        )}

        {/* Action bar */}
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => void saveProgramme()}
            disabled={saving || blocks.length === 0}
            className="border border-border rounded-md px-4 py-2 text-sm font-medium hover:bg-background disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save programme'}
          </button>
          <button
            onClick={() => void confirmAndGenerate()}
            data-testid="schedule-generate"
            disabled={generating || blocks.length === 0}
            className="bg-accent hover:bg-accent-hover disabled:opacity-50 text-accent-foreground font-semibold py-2 px-4 rounded-md text-sm"
          >
            {generating ? 'Generating…' : `${generateGridLabel ?? 'Generate Grid'} →`}
          </button>
          <button
            onClick={() => void confirmAndReset()}
            disabled={resetting}
            className="ml-auto rounded-md border border-danger/30 px-4 py-2 text-sm font-medium text-danger hover:bg-danger/10 disabled:opacity-50"
            title="Wipe the programme + clear every scheduled match"
          >
            {resetting ? 'Resetting…' : 'Reset schedule'}
          </button>
        </div>
      </div>

      {confirmDialog}
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
  const tint = blockTint(block.colorHex);

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      style={tint ?? undefined}
      className={[
        'border rounded-xl transition-opacity',
        tint ? '' : (BLOCK_TYPE_COLORS[block.blockType] ?? 'bg-gray-50 border-gray-200'),
        dragging ? 'opacity-40' : '',
      ].join(' ')}
    >
      {/* Main row */}
      <div className="flex items-center gap-3 px-3 py-2.5">
        {/* Drag handle */}
        <span className="text-muted cursor-grab active:cursor-grabbing text-lg leading-none select-none">
          ⠿
        </span>

        {/* Icon */}
        <span className="text-base leading-none">{BLOCK_TYPE_ICONS[block.blockType] ?? '📌'}</span>

        {/* Times — custom HH:MM text inputs (not native <input type="time">,
            which renders AM/PM in 12-hour locales). Matches the config form. */}
        <div className="flex items-center gap-1 text-xs text-muted font-mono flex-shrink-0">
          <input
            type="text"
            inputMode="numeric"
            pattern="^([01]?[0-9]|2[0-3]):[0-5][0-9]$"
            placeholder="HH:MM"
            maxLength={5}
            value={block.startTime}
            onChange={(e) => onChange({ startTime: e.target.value })}
            className="border-0 bg-transparent text-xs font-mono w-12 focus:outline-none focus:ring-1 focus:ring-accent rounded"
          />
          <span>–</span>
          <input
            type="text"
            inputMode="numeric"
            pattern="^([01]?[0-9]|2[0-3]):[0-5][0-9]$"
            placeholder="HH:MM"
            maxLength={5}
            value={block.endTime}
            onChange={(e) => onChange({ endTime: e.target.value })}
            className="border-0 bg-transparent text-xs font-mono w-12 focus:outline-none focus:ring-1 focus:ring-accent rounded"
          />
        </div>

        {/* Label */}
        <span className="flex-1 text-sm font-medium text-foreground truncate">{block.label}</span>

        {/* Lice badge */}
        {block.liceCount > 0 && (
          <span className="text-xs bg-surface border border-border rounded-full px-2 py-0.5 text-muted flex-shrink-0">
            {block.liceCount} lice{block.liceCount !== 1 ? 's' : ''}
          </span>
        )}

        {/* Warning badge */}
        {warning && (
          <span className="text-xs bg-warning/10 border border-warning/30 text-warning rounded-full px-2 py-0.5 flex-shrink-0">
            ⚠ +{warning.overflowMinutes}min
          </span>
        )}

        {/* Expand / remove */}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-muted hover:text-foreground-secondary text-xs px-1"
        >
          {expanded ? '▲' : '▾'}
        </button>
        <button onClick={onRemove} className="text-muted hover:text-danger text-xs px-1">
          ✕
        </button>
      </div>

      {/* Warning actions */}
      {warning && (
        <div className="px-10 pb-2 flex items-center gap-3 text-xs text-warning">
          <span>{warning.message}.</span>
          <button onClick={onApplyWarning} className="underline hover:no-underline">
            Suggest fit ({warning.suggestedEndTime})
          </button>
          <button onClick={onDismissWarning} className="text-muted hover:text-foreground-secondary">
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
                <span className="text-muted">Lices</span>
                <input
                  type="number"
                  min={1}
                  value={block.liceCount}
                  onChange={(e) => onChange({ liceCount: Number(e.target.value) })}
                  className="border border-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-accent w-20"
                />
              </label>
              <label className="flex flex-col gap-0.5">
                <span className="text-muted">Match duration (min)</span>
                <input
                  type="number"
                  min={1}
                  value={block.matchDurationMinutes}
                  onChange={(e) => onChange({ matchDurationMinutes: Number(e.target.value) })}
                  className="border border-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-accent w-20"
                />
              </label>
              <label className="flex flex-col gap-0.5">
                <span className="text-muted">Match gap (sec)</span>
                <input
                  type="number"
                  min={0}
                  value={block.matchGapSeconds}
                  onChange={(e) => onChange({ matchGapSeconds: Number(e.target.value) })}
                  className="border border-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-accent w-20"
                />
              </label>
              <label className="flex flex-col gap-0.5">
                <span className="text-muted">Min rest / fighter (min)</span>
                <input
                  type="number"
                  min={0}
                  value={block.minRestMinutes}
                  onChange={(e) => onChange({ minRestMinutes: Number(e.target.value) })}
                  className="border border-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-accent w-20"
                />
              </label>
            </>
          )}
          <label className="flex flex-col gap-0.5 col-span-2">
            <span className="text-muted">Label</span>
            <input
              type="text"
              value={block.label}
              onChange={(e) => onChange({ label: e.target.value })}
              className="border border-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </label>
          {block.blockType !== 'competition' && (
            <div className="col-span-2 flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <span className="text-muted">Color</span>
                {block.colorHex ? (
                  <button
                    onClick={() => onChange({ colorHex: null })}
                    className="text-[11px] font-medium text-muted hover:text-foreground-secondary"
                  >
                    Default
                  </button>
                ) : null}
              </div>
              <ColorSwatchPicker
                value={block.colorHex ?? ''}
                onChange={(hex) => onChange({ colorHex: hex })}
                ariaLabel="Block color"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
