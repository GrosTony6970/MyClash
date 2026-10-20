'use client';

import { useCallback, useState } from 'react';
import {
  applyForfeitPatch,
  type ForfeitChanges,
  type ForfeitPatch,
} from '@myclash/types/forfeit-rules';
import { patchOf } from './patch-of';
import { useForfeitRules, type StoredForfeit } from './useForfeitRules';

/**
 * The forfeit changes of a Tournament in Step 1 of the wizard (ruling 65): the form, a resumed
 * draft's pin and changes as stored, and the rules they are laid over. The Basics tab holds its
 * form in its own state instead, so its one dirty report covers it.
 */
export function useForfeitForm(eventId: string, tournamentId: string | null, pick: string) {
  const [value, setValue] = useState<ForfeitPatch | null>(null);
  const [stored, setStored] = useState<StoredForfeit | null>(null);
  const shown = useForfeitRules(eventId, tournamentId, pick, stored);
  /** A resumed draft's row: its pin and its changes, as the form starts from them. */
  const adopt = useCallback((row: Record<string, unknown>) => {
    // As stored: a restored archive's `{}` is no change, as the server reads it.
    const forfeit = applyForfeitPatch((row['forfeit_rules'] as ForfeitChanges | null) ?? null, {});
    setStored({ pin: (row['penalty_ruleset_id'] as string | null) ?? null, forfeit });
    setValue(forfeit);
  }, []);
  return {
    block: { shown, saved: stored?.forfeit ?? null, value, onChange: setValue },
    adopt,
    /** What a save sends: the changes the form made, or nothing. */
    patch: () => patchOf(stored?.forfeit ?? {}, value ?? {}) ?? undefined,
  };
}
