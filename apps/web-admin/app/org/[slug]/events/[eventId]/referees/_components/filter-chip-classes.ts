/**
 * The className for one filter chip in the referee workspace's filter card.
 *
 * Pure and unit-tested on purpose: nothing in the gate chain reads a
 * component's classNames, so an assertion on these exact strings is the only
 * thing holding the token choice. `quality:design-drift` compares DESIGN.md
 * against theme.css and never opens a .tsx file.
 *
 * The idle hover is `hover:border-accent`, not the `hover:border-border` the
 * older chips on this page use — that one resolves to the resting border, so
 * it is a hover state that cannot be seen. theme.css has no stronger neutral
 * border token, so accent is the honest cue.
 */

const BASE = 'min-h-[40px] rounded-full border px-4 py-2 text-sm font-semibold transition-colors';
const SELECTED = 'border-accent bg-accent text-accent-foreground';
const IDLE =
  'border-border bg-surface text-foreground-secondary hover:border-accent hover:text-foreground';

export function filterChipClasses(selected: boolean): string {
  return `${BASE} ${selected ? SELECTED : IDLE}`;
}
