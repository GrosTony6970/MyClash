'use client';

import { useCallback, useState } from 'react';
import { bodyForKind, kindOfRow, numberOrNull, textOf, type EntrantKind } from './entrant-kind';

/**
 * The kind of entrant in Step 1 of the wizard: the choice, a team Tournament's default size, and a
 * resumed draft's stored kind and entrants, which fix its kind. The settings Basics tab holds them
 * in its own form instead, so its one dirty report covers them (as `useForfeitForm` says of the
 * forfeit rules).
 */
export function useEntrantKind() {
  const [kind, setKind] = useState<EntrantKind>('individual');
  const [size, setSize] = useState('');
  // A new Tournament's kind is the server's default until a resumed draft says otherwise.
  const [storedKind, setStoredKind] = useState<EntrantKind>('individual');
  const [entrantCount, setEntrantCount] = useState(0);
  /** A resumed draft's row: its kind, its size and its entrants. */
  const adopt = useCallback((row: Record<string, unknown>) => {
    const stored = kindOfRow(row);
    setKind(stored.kind);
    setStoredKind(stored.kind);
    setSize(textOf(stored.teamDefaultSize));
    setEntrantCount(stored.entrantCount);
  }, []);
  const fixed = entrantCount > 0;
  return {
    kind,
    field: { kind, onKind: setKind, teamDefaultSize: size, onTeamDefaultSize: setSize, fixed },
    adopt,
    /** A create's body: an individual create sends no kind, so its body is the one it was. */
    create: (body: Record<string, unknown>) =>
      bodyForKind(body, kind, numberOrNull(size), 'individual'),
    /** A resumed draft's save: its kind only when changed. */
    save: (body: Record<string, unknown>) =>
      bodyForKind(body, kind, numberOrNull(size), storedKind),
  };
}
