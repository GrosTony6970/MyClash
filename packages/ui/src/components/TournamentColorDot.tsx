import * as React from 'react';
import { accentClassFor, type ColorToken } from '../utils/color-token';

export interface TournamentColorDotProps {
  /** ColorToken string (e.g. "red", "amber"). Renders nothing when null/empty. */
  color?: ColorToken | string | null;
  /** Visual size. Defaults to 'sm' (8px). 'md' is 10px. */
  size?: 'sm' | 'md';
  /** Optional tooltip / accessible label. */
  title?: string;
}

const SIZE_MAP: Record<NonNullable<TournamentColorDotProps['size']>, string> = {
  sm: 'h-2 w-2',
  md: 'h-2.5 w-2.5',
};

/**
 * Renders a small filled circle next to a tournament name. Returns null
 * when no color is set so consumers can drop it in unconditionally
 * without worrying about a stray empty dot.
 */
export function TournamentColorDot({
  color,
  size = 'sm',
  title,
}: TournamentColorDotProps): React.ReactElement | null {
  if (!color) return null;
  return (
    <span
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      title={title}
      // The inset ring gives a light colour an edge: a white, silver, yellow or gold dot was
      // 1.1:1 to 1.7:1 against a white card and showed no shape (known-deviations D31).
      className={[
        'inline-block shrink-0 rounded-full ring-1 ring-inset ring-foreground/50',
        SIZE_MAP[size],
        accentClassFor(color),
      ].join(' ')}
    />
  );
}
