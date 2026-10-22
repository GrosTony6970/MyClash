/**
 * What a clone/adopt source implies about the row you are about to create.
 *
 * "Clone" and "Adopt" both land on the org create page with `?cloneFrom=<id>`.
 * If the source is TF v1 — the built-in itself, or someone's `base_code` fork
 * of it — the copy must stay coded, or it silently degrades into an empty
 * formula ruleset and drops every tunable the source carried. A copy of Points
 * cap is a formula ruleset of the club's own (operator ruling 133): it starts
 * from Points cap's match format, and the club writes its formula.
 *
 * Pure: no React, no I/O.
 */

import { rulesetEditorKind } from './ruleset-kind';

/** The subset of a catalog row this derivation needs. */
export interface CloneSourceRow {
  code: string;
  version: string;
  base_code: string | null;
  base_version: string | null;
}

export interface CodedCloneBase {
  baseCode: string;
  /**
   * Absent for a clone of the built-in itself: the server bases it on the
   * built-in's latest version. The mirror row's own version is the one it was
   * seeded with, an older engine once a newer one is registered.
   */
  baseVersion?: string;
}

/**
 * The built-in a clone of `src` must be based on, or null when `src` is not TF
 * v1 or a copy of it (it clones as a formula ruleset).
 *
 * A fork resolves to ITS OWN base, never to the fork itself: only a built-in
 * can be a base — its algorithm is the thing being reused — and the API's
 * `isSystemRuleset` check rejects anything else. This is what makes adopting
 * another org's shared fork produce a fork of TF v1 rather than a dangling
 * reference to a row that org could later delete. Adopting a fork keeps the
 * version it is based on: a fork of 1.0.0 stays 1.0.0.
 */
export function cloneCodedBase(src: CloneSourceRow): CodedCloneBase | null {
  if (rulesetEditorKind(src.code, src.base_code) !== 'tf') return null;
  if (src.base_code) {
    return { baseCode: src.base_code, baseVersion: src.base_version ?? '1.0.0' };
  }
  return { baseCode: src.code };
}
