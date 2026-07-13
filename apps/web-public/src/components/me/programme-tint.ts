// Inline tint for a programme context bar (registration / referee meeting /
// lunch break…) that carries an admin-chosen colour. Mirrors the admin
// scheduler's block-tint: a solid border in the chosen hex + a translucent
// (~13%) fill of the same hue. Returns null when there's no valid colour so the
// caller keeps its neutral default classes. Pure: no React, no I/O.

const HEX6 = /^#[0-9a-fA-F]{6}$/;

export function programmeTint(
  colorHex: string | null | undefined,
): { borderColor: string; backgroundColor: string } | null {
  if (!colorHex || !HEX6.test(colorHex)) return null;
  return { borderColor: colorHex, backgroundColor: `${colorHex}22` };
}
