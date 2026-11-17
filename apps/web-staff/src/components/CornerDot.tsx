/**
 * A fighter's corner colour beside their name or their number, never as the ink of the words.
 *
 * The pad wrote names, round tallies and the round's winner in the corner colour. On the dark pad
 * blue was 2.83:1 and red 3.03:1 as text, a black or a white corner 1.4:1 (known-deviations D38).
 * By the operator's ruling the words take the page's ink and the colour sits beside them: a hue is
 * safe as a fill and unsafe as ink (D12). The inset ring gives a black or white corner an edge on
 * either theme, as `TournamentColorDot` does.
 */
export function CornerDot({ hex, className = '' }: { hex: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-inset ring-foreground/50 ${className}`}
      style={{ backgroundColor: hex }}
    />
  );
}
