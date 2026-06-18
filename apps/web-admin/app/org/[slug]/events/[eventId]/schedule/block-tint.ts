/**
 * Inline tint for a programme bar that carries a custom color. Returns a solid
 * border in the chosen hex plus a translucent (~13%) fill of the same hue, or
 * `null` when there's no valid color so the caller keeps its per-kind default
 * classes. Text colour stays neutral (set by the caller) for legibility.
 *
 * Pure: no React, no I/O.
 */

const HEX6 = /^#[0-9a-fA-F]{6}$/;

export function blockTint(
  colorHex: string | null | undefined,
): { borderColor: string; backgroundColor: string } | null {
  if (!colorHex || !HEX6.test(colorHex)) return null;
  return { borderColor: colorHex, backgroundColor: `${colorHex}22` };
}
