/**
 * Choose which sidebar nav item should render as active for the
 * current pathname.
 *
 * Items default to prefix matching (`startsWith(href + '/')`) so
 * sub-routes still highlight their parent — e.g.
 * `/org/x/rulesets/scoring` highlights the `Rulesets` entry.
 *
 * `exact: true` opts an item out of prefix matching. Used for
 * nav items whose sub-routes belong to a different section (the
 * org-level "Events list" link, whose sub-routes
 * `/org/x/events/{id}/...` are owned by the Event section).
 */
export interface NavMatchItem {
  href: string;
  exact?: boolean;
}

export function pickActiveHref(
  pathname: string,
  items: ReadonlyArray<NavMatchItem>,
): string | null {
  let best: string | null = null;
  for (const item of items) {
    const matches = item.exact
      ? pathname === item.href
      : pathname === item.href || (item.href !== '/' && pathname.startsWith(`${item.href}/`));
    if (!matches) continue;
    if (best === null || item.href.length > best.length) best = item.href;
  }
  return best;
}
