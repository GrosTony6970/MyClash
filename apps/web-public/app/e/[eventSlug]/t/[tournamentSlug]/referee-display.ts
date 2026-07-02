/**
 * Shared referee-display helpers for the public tournament surfaces (Pool List
 * footer + bracket cards). Plain module — no `'use client'` — so it is safe in
 * both the SSR PoolsCompositionView and the client-side BracketLive.
 */

/**
 * Humanise a `referee_skills.id` role string (e.g. 'arbitre_declarant') into a
 * short label. The FR-named skill ids are deliberately language-neutral on the
 * public view, so this is not translated — it mirrors the label the operator
 * sees in the admin. Unknown roles fall back to the raw id; null → "Referee".
 */
export function refereeRoleLabel(role: string | null): string {
  if (!role) return 'Referee';
  const map: Record<string, string> = {
    arbitre_declarant: 'Déclarant',
    arbitre_assesseur: 'Assesseur',
    arbitre_table: 'Table',
  };
  return map[role] ?? role;
}
