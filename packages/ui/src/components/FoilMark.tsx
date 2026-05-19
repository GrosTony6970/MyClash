import * as React from 'react';

/**
 * FoilMark — the signature heraldic accent of the Tournament Manual aesthetic.
 *
 * A 24×6 SVG glyph rendered as a hairline horizontal divider that evokes a
 * fencing foil's cross-guard (handle on the right, point on the left). Used
 * as a quiet recurring motif: under page-header eyebrows, on empty states,
 * inside the design-system reference. Color-controlled via `className`.
 *
 * Default styling: stroke uses `currentColor` so callers set `text-*` on the
 * parent.
 */
export interface FoilMarkProps {
  className?: string;
  /** Aspect-friendly width. Default 32px. */
  width?: number;
  /** Aria-hidden by default (decorative). Set to a string to announce. */
  ariaLabel?: string;
}

export const FoilMark: React.FC<FoilMarkProps> = ({
  className = 'text-slate-300',
  width = 32,
  ariaLabel,
}) => (
  <svg
    width={width}
    height={(width / 32) * 6}
    viewBox="0 0 32 6"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden={ariaLabel ? undefined : true}
    aria-label={ariaLabel}
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth="1"
    strokeLinecap="round"
  >
    {/* Point (left) → blade → cross-guard → grip (right) */}
    <line x1="0.5" y1="3" x2="20" y2="3" />
    {/* Cross-guard */}
    <line x1="20" y1="0.5" x2="20" y2="5.5" />
    {/* Grip taper */}
    <line x1="20" y1="3" x2="28" y2="3" strokeWidth="1.5" />
    {/* Pommel */}
    <circle cx="29.5" cy="3" r="1.25" fill="currentColor" stroke="none" />
  </svg>
);
