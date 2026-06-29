'use client';

import { createContext } from 'react';

export interface BracketHighlight {
  /** Registration id of the logged-in viewer — marks their slots with a "YOU" chip. */
  highlightRegistrationId?: string | null;
  /** i18n'd "YOU" label (the lib stays i18n-free; the app passes it in). */
  youLabel?: string;
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
