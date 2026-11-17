import * as React from 'react';

/**
 * Lucide's `hand` glyph (lucide-react 1.72.0, ISC), drawn inline: the mark of a
 * protest, the same hand the protest chips show.
 *
 * Inline rather than imported. `packages/ui` compiles to CommonJS, so a
 * `require('lucide-react')` ships the whole icon barrel to every app
 * (`NavIcon.tsx` says why it vendors its glyphs for the same reason). The
 * strokes are `currentColor`, so the mark takes the row's token colour.
 * `MatchTimeline.render.test.tsx` compares these paths with lucide's, so a
 * lucide redraw turns a test red rather than drifting.
 */
export const HAND_PATHS = [
  'M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2',
  'M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2',
  'M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8',
  'M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15',
] as const;

export function HandMark({ className }: { className?: string }): React.ReactElement {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {HAND_PATHS.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
