/**
 * branding.ts — the default accent colours, and the one helper that paints them.
 *
 * Every colour a MyClash surface renders is either a hex somebody picked or a
 * default. The defaults kept being re-declared next to whichever component
 * needed one, and they drifted: the org branding picker rang the slate swatch
 * while the preview beside it — and the public event card it previews — drew
 * `#dc2626`. Programme blocks were worse. Their "default" wasn't a hex at all
 * but a Tailwind class map, written twice in web-admin with different values
 * (`gray-50/200` in the planner, `slate-100/300` in the grid) and a third time
 * in web-public as neutral tokens. A picker cannot ring a swatch that matches a
 * class.
 *
 * So: defaults are hexes, they live here, and both apps resolve through
 * `resolveBlockAccent` before drawing anything. A picker seeded from the same
 * constant then cannot disagree with the surface next to it.
 */

/**
 * Accent an organization's event cards fall back to when `brand_color` is NULL
 * — the left-edge stripe on the public landing page, mirrored in the admin
 * branding preview. Present in the admin swatch palette on purpose: it is what
 * the picker rings when no colour has been chosen.
 */
export const DEFAULT_ORG_ACCENT = '#dc2626';

/**
 * Accent a programme block falls back to when `color_hex` is NULL, keyed by
 * block kind. `blockType` (planner) and `kind` (grid, public schedule) name the
 * same thing, so both index this map.
 */
export const DEFAULT_BLOCK_ACCENT: Readonly<Record<string, string>> = {
  break: '#64748b', // slate-500
  admin: '#a855f7', // purple-500
  competition: '#3b82f6', // blue-500
  workshop: '#f59e0b', // amber-500
};

/** Accent for a kind nobody has assigned a colour to. Neutral by design. */
export const FALLBACK_BLOCK_ACCENT = '#64748b';

const HEX6 = /^#[0-9a-fA-F]{6}$/;

/**
 * The stored hex when it is usable, else the kind's default. A blank or
 * malformed stored value falls through to the default rather than leaving the
 * bar untinted — an untinted bar is exactly the state the pickers could not
 * describe.
 */
export function resolveBlockAccent(kind: string, colorHex: string | null | undefined): string {
  if (colorHex && HEX6.test(colorHex)) return colorHex;
  return DEFAULT_BLOCK_ACCENT[kind] ?? FALLBACK_BLOCK_ACCENT;
}

/**
 * Inline style for a programme bar: a solid border in the accent plus a
 * translucent (~13%) fill of the same hue, so the label stays readable in both
 * themes. Text colour is the caller's business.
 *
 * Takes a resolved accent, never a nullable stored value — the `22` alpha
 * suffix needs a 6-digit hex, which `resolveBlockAccent` guarantees.
 */
export function blockTint(accentHex: string): { borderColor: string; backgroundColor: string } {
  const safe = HEX6.test(accentHex) ? accentHex : FALLBACK_BLOCK_ACCENT;
  return { borderColor: safe, backgroundColor: `${safe}22` };
}
