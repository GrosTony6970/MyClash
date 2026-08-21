'use client';

import { createContext } from 'react';

export interface BracketHighlight {
  /** Registration id of the logged-in viewer — marks their slots with a "YOU" chip. */
  highlightRegistrationId?: string | null;
  /** i18n'd "YOU" label (the lib stays i18n-free; the app passes it in). */
  youLabel?: string;
  /** When true, each card renders its assigned referees below the pill row. A
   *  single flag for the whole bracket (driven by the fold/unfold toggle). */
  showReferees?: boolean;
  /** `${slotId}::${role ?? ''}` keys flagging the viewer's own referee rows
   *  (accent name + "YOU" chip). Undefined → no referee self-highlight. */
  refereeSelfKeys?: ReadonlySet<string>;
  /** Humanises a referee_skills.id role into a label. App-provided (the lib is
   *  i18n-free); falls back to the raw role when omitted. */
  refereeRoleLabel?: (role: string | null) => string;
  /**
   * Lice whose matches this bracket should call out. Undefined → no lice
   * highlight, so the admin and public brackets render unchanged.
   *
   * Set only by the scoring app's per-piste screen, where "which of these is
   * mine" is the operator's only question.
   *
   * ── It SCOPES the bracket, it does not merely annotate it ─────────────────
   * Setting this does three things together, because on that screen they are
   * one thing: this Lice's cards are ringed, the others are dimmed, and only
   * this Lice's cards open. See `MatchCard`, which holds the rule and the
   * reason. A caller that wants the ring without the scoping does not exist
   * today; if one appears, split this into two fields rather than loosening
   * the rule — an operator who can open another piste's bout in one tap is how
   * a bout gets recorded twice.
   */
  highlightLiceId?: string | null;
}

/**
 * Lets a personal-space bracket flag the viewer's own slots without threading
 * props through every layout + MatchCard call site. Empty by default → no
 * highlight, so the public + admin brackets render identically.
 *
 * `createContext` is a client-only API, so this lives in its own `'use client'`
 * module — otherwise importing the @myclash/ui barrel into a React Server
 * Component evaluates `createContext` in the RSC runtime and throws.
 */
export const BracketHighlightContext = createContext<BracketHighlight>({});
