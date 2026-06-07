/**
 * side-color.ts
 *
 * Centralised side-colour resolution for the scoring app.
 *
 * Operators configure each tournament's "red" and "blue" fighter sides
 * to one of 11 colour tokens (white, black, grey, yellow, red, blue,
 * green, brown, pink, orange, purple) via the admin tournament
 * settings. The configured colour is stored at
 * `tournaments.scoring_config_json.display.sideColors.{red,blue}` and
 * surfaces in the scoring app via the
 * `/api/v1/tournaments/:id/match-config` endpoint as
 * `scoringConfig.display.sideColors.{red,blue}`.
 *
 * This module is the SINGLE source of truth for how a side colour
 * token maps to UI styles. Every consumer (ScoringPad, ScoringColumn,
 * ScoringCenterControls, the header subtitle, penalty card chips, the
 * next-match tile) must call `sideStyle(config, side)` rather than
 * hardcode `bg-red-*` / `bg-blue-*` Tailwind classes. The dormant
 * ExchangePad wizard predates this module — when it's reactivated it
 * should plumb `config` through and call `sideStyle()` for its
 * "choose striker" buttons.
 */

import type { TournamentScoringConfig } from '@myclash/types';

export type SideColorToken =
  | 'white'
  | 'black'
  | 'grey'
  | 'yellow'
  | 'red'
  | 'blue'
  | 'green'
  | 'brown'
  | 'pink'
  | 'orange'
  | 'purple';

export interface SideColorStyle {
  /** Token name — useful for debugging and CSS variable hooks. */
  token: SideColorToken;
  /** Panel/background hex (also used for big score numerals + name text). */
  panel: string;
  /** Border hex (slightly lighter than panel). */
  border: string;
  /** Text colour on top of `hex` panel (white or near-black). */
  text: string;
  /** Muted text colour for sub-labels on the panel. */
  muted: string;
  /**
   * Tailwind class string for buttons rendered ON a dark scoring
   * surface — handles bg + border + text + hover + active states.
   * Mirrors the legacy `cardClass` map at ExchangePad.tsx so the
   * point and afterblow buttons keep their existing visual weight.
   */
  buttonClasses: string;
}

const STYLES: Record<SideColorToken, SideColorStyle> = {
  white: {
    token: 'white',
    panel: '#f8fafc',
    border: '#cbd5e1',
    text: '#0f172a',
    muted: '#475569',
    buttonClasses: 'bg-gray-700 border-gray-500 text-white hover:bg-gray-600 active:bg-gray-500',
  },
  black: {
    token: 'black',
    panel: '#020617',
    border: '#334155',
    text: '#f8fafc',
    muted: '#cbd5e1',
    buttonClasses: 'bg-gray-900 border-gray-700 text-gray-100 hover:bg-gray-800 active:bg-gray-700',
  },
  grey: {
    token: 'grey',
    panel: '#334155',
    border: '#64748b',
    text: '#f8fafc',
    muted: '#cbd5e1',
    buttonClasses:
      'bg-slate-700 border-slate-500 text-slate-100 hover:bg-slate-600 active:bg-slate-500',
  },
  yellow: {
    token: 'yellow',
    panel: '#713f12',
    border: '#ca8a04',
    text: '#fef9c3',
    muted: '#fde68a',
    buttonClasses:
      'bg-yellow-800 border-yellow-600 text-yellow-100 hover:bg-yellow-700 active:bg-yellow-600',
  },
  red: {
    token: 'red',
    panel: '#7f1d1d',
    border: '#dc2626',
    text: '#fee2e2',
    muted: '#fca5a5',
    buttonClasses: 'bg-red-900 border-red-600 text-red-100 hover:bg-red-800 active:bg-red-700',
  },
  blue: {
    token: 'blue',
    panel: '#1e3a8a',
    border: '#2563eb',
    text: '#dbeafe',
    muted: '#93c5fd',
    buttonClasses: 'bg-blue-900 border-blue-600 text-blue-100 hover:bg-blue-800 active:bg-blue-700',
  },
  green: {
    token: 'green',
    panel: '#14532d',
    border: '#16a34a',
    text: '#dcfce7',
    muted: '#86efac',
    buttonClasses:
      'bg-green-800 border-green-600 text-green-100 hover:bg-green-700 active:bg-green-600',
  },
  brown: {
    token: 'brown',
    panel: '#422006',
    border: '#92400e',
    text: '#ffedd5',
    muted: '#fdba74',
    buttonClasses:
      'bg-amber-900 border-amber-700 text-amber-100 hover:bg-amber-800 active:bg-amber-700',
  },
  pink: {
    token: 'pink',
    panel: '#831843',
    border: '#db2777',
    text: '#fce7f3',
    muted: '#f9a8d4',
    buttonClasses: 'bg-pink-800 border-pink-600 text-pink-100 hover:bg-pink-700 active:bg-pink-600',
  },
  orange: {
    token: 'orange',
    panel: '#7c2d12',
    border: '#ea580c',
    text: '#ffedd5',
    muted: '#fdba74',
    buttonClasses:
      'bg-orange-800 border-orange-600 text-orange-100 hover:bg-orange-700 active:bg-orange-600',
  },
  purple: {
    token: 'purple',
    panel: '#581c87',
    border: '#9333ea',
    text: '#f3e8ff',
    muted: '#d8b4fe',
    buttonClasses:
      'bg-purple-800 border-purple-600 text-purple-100 hover:bg-purple-700 active:bg-purple-600',
  },
};

/**
 * Resolve the configured colour for the given side ('red' or 'blue').
 * Falls back to the side's own token (so a red fighter without any
 * configuration still renders red) if the config is missing or
 * malformed. The fallback matches today's behaviour on first paint
 * before the match-config endpoint resolves.
 */
export function sideStyle(
  config: TournamentScoringConfig | null | undefined,
  side: 'red' | 'blue',
): SideColorStyle {
  const configuredToken = config?.display?.sideColors?.[side] as SideColorToken | undefined;
  return STYLES[configuredToken ?? side];
}

/**
 * Resolve any colour token directly (no per-side config lookup).
 * Used for penalty card chips and direct-card buttons where the
 * ruleset specifies the colour directly rather than via a side.
 */
export function styleForToken(token: SideColorToken | string): SideColorStyle {
  return STYLES[(token as SideColorToken) in STYLES ? (token as SideColorToken) : 'grey'];
}
