/**
 * What a clone/adopt source implies about the row you are about to create.
 *
 * "Clone" and "Adopt" both land on the org create page with `?cloneFrom=<id>`.
 * If the source's maths lives in CODE — the built-in itself, or someone's
 * `base_code` fork of it — the copy must stay coded, or it silently degrades
 * into an empty formula ruleset and drops every tunable the source carried.
 *
 * Pure: no React, no I/O.
 */

/** The subset of a catalog row this derivation needs. */
export interface CloneSourceRow {
  code: string;
  version: string;
  is_system: boolean;
  base_code: string | null;
  base_version: string | null;
}

export interface CodedCloneBase {
  baseCode: string;
  baseVersion: string;
}

/**
 * The built-in a clone of `src` must be based on, or null when `src` is an
 * authored formula ruleset (which clones as a formula ruleset, unchanged).
 *
 * A fork resolves to ITS OWN base, never to the fork itself: only a built-in
 * can be a base — its algorithm is the thing being reused — and the API's
 * `isSystemRuleset` check rejects anything else. This is what makes adopting
 * another org's shared fork produce a fork of TF v1 rather than a dangling
 * reference to a row that org could later delete.
 */
export function cloneCodedBase(src: CloneSourceRow): CodedCloneBase | null {
  if (src.base_code) {
    return { baseCode: src.base_code, baseVersion: src.base_version ?? '1.0.0' };
  }
  if (src.is_system) {
    return { baseCode: src.code, baseVersion: src.version };
  }
  return null;
}
