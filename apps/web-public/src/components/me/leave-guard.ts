/**
 * Which link clicks leave a page that holds unsaved edits (quick-win M4, operator 2026-10-14).
 *
 * The page asks first, with the app's own dialog, for a plain click on a link to another page of
 * the site. Everything else is the browser's: a click that opens a new tab or a download leaves
 * the page as it is, and a link to another site unloads it, where the browser's own "Leave site?"
 * (`beforeunload`) asks.
 */

export interface LinkClick {
  defaultPrevented: boolean;
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export interface LinkAttributes {
  href: string | null;
  target: string | null;
  download: boolean;
}

/** The in-site address the click goes to, or null when the page must not step in. */
export function leaveTarget(click: LinkClick, anchor: LinkAttributes, here: string): string | null {
  if (click.defaultPrevented || click.button !== 0) return null;
  if (click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return null;
  if (!anchor.href || anchor.download || (anchor.target && anchor.target !== '_self')) return null;
  const current = new URL(here);
  const next = new URL(anchor.href, current);
  if (next.origin !== current.origin) return null;
  if (next.pathname === current.pathname && next.search === current.search) return null;
  return `${next.pathname}${next.search}${next.hash}`;
}
