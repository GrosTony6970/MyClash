/**
 * status-pill.ts
 *
 * Canonical palette + per-domain mappers for the "status pill"
 * (Draft / Published / Live / Paused / Completed / Archived / Voided).
 *
 * Two layers:
 *
 *   1. `StatusSemantic` — small enum of seven INTENTS. Same intent →
 *      same colour everywhere, regardless of which domain status
 *      string it came from. `draft`, `scheduled`, `hidden` all
 *      collapse to `'pending'`; `voided`, `disqualified`, `rejected`
 *      all collapse to `'danger'`.
 *
 *   2. `statusPillTone(semantic, surface)` returns the Tailwind class
 *      string + a `pulse` flag for the chip. `surface='light'` for
 *      admin pages, `'dark'` for the scoring app and TV display.
 *
 * Per-domain mappers (`tournamentStatusSemantic`, `matchStatusSemantic`,
 * `phaseVisibilitySemantic`, `clockStatusSemantic`, `rulesetSemantic`)
 * translate a concrete status string to a `StatusSemantic`. Every
 * status pill in the codebase should pipe through one of these
 * mappers → `statusPillTone` → the rendered chip. No inline
 * status-to-Tailwind maps anywhere else.
 */

export type StatusSemantic =
  | 'pending'
  | 'ready'
  | 'live'
  | 'paused'
  | 'done'
  | 'archived'
  | 'danger';

export type StatusSurface = 'light' | 'dark';

export interface StatusPillTone {
  /** Tailwind class string: bg + text + border (no padding / radius). */
  className: string;
  /** Whether to add `animate-pulse` for liveness. */
  pulse: boolean;
}

const LIGHT_TONES: Record<StatusSemantic, string> = {
  pending: 'bg-slate-100 text-slate-700 border-slate-200',
  ready: 'bg-blue-50 text-blue-700 border-blue-200',
  live: 'bg-green-50 text-green-700 border-green-200',
  paused: 'bg-amber-50 text-amber-800 border-amber-200',
  done: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  archived: 'bg-stone-200 text-stone-700 border-stone-300',
  danger: 'bg-red-50 text-red-700 border-red-200',
};

const DARK_TONES: Record<StatusSemantic, string> = {
  pending: 'bg-slate-800/80 text-slate-300 border-slate-700',
  ready: 'bg-blue-900/60 text-blue-300 border-blue-800',
  live: 'bg-green-900/60 text-green-300 border-green-800',
  paused: 'bg-amber-900/60 text-amber-300 border-amber-800',
  done: 'bg-emerald-900/40 text-emerald-300 border-emerald-800',
  archived: 'bg-stone-900/60 text-stone-400 border-stone-800',
  danger: 'bg-red-900/60 text-red-300 border-red-800',
};

export function statusPillTone(semantic: StatusSemantic, surface: StatusSurface): StatusPillTone {
  const className = surface === 'dark' ? DARK_TONES[semantic] : LIGHT_TONES[semantic];
  return { className, pulse: semantic === 'live' };
}

// ── Per-domain mappers ────────────────────────────────────────────

export type TournamentStatus = 'draft' | 'published' | 'running' | 'completed' | 'archived';

export function tournamentStatusSemantic(status: string): StatusSemantic {
  switch (status) {
    case 'running':
      return 'live';
    case 'published':
      return 'ready';
    case 'completed':
      return 'done';
    case 'archived':
      return 'archived';
    case 'draft':
    default:
      return 'pending';
  }
}

export type MatchStatus = 'scheduled' | 'running' | 'paused' | 'completed' | 'voided';

export function matchStatusSemantic(status: string): StatusSemantic {
  switch (status) {
    case 'running':
      return 'live';
    case 'paused':
      return 'paused';
    case 'completed':
      return 'done';
    case 'voided':
      return 'danger';
    case 'scheduled':
    default:
      return 'pending';
  }
}

export type PhaseVisibility = 'hidden' | 'published';

export function phaseVisibilitySemantic(visibility: string): StatusSemantic {
  return visibility === 'published' ? 'ready' : 'pending';
}

export type ClockStatus = 'idle' | 'running' | 'halted' | 'ended';

export function clockStatusSemantic(status: string): StatusSemantic {
  switch (status) {
    case 'running':
      return 'live';
    case 'halted':
      return 'paused';
    case 'ended':
      return 'done';
    case 'idle':
    default:
      return 'pending';
  }
}

export type RulesetVariant =
  | 'builtin'
  | 'custom'
  | 'default'
  | 'published'
  | 'draft'
  | 'pendingReview';

export function rulesetSemantic(variant: string): StatusSemantic {
  switch (variant) {
    case 'published':
    case 'builtin':
    case 'default':
      return 'ready';
    case 'pendingReview':
      return 'paused';
    case 'draft':
    case 'custom':
    default:
      return 'pending';
  }
}
