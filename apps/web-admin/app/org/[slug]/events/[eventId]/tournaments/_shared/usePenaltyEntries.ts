'use client';

import { useEffect, useState } from 'react';
import { apiRequest } from '@myclash/api-client';
import { comparePenaltyEntries } from '@myclash/types';
import { getPublicApiUrl } from '@/lib/api-url';

const apiUrl = getPublicApiUrl();

export interface PenaltyEntry {
  id: string;
  ref_number: string;
  short_name: string;
  group_number: number;
  sanctions: string[];
}

/**
 * The Tournament's penalty list in force, sorted as a person reads it (`comparePenaltyEntries`):
 * the quick-pick pins of the Display tab, and the penalty a protest past the limit offers (the tab
 * and wizard Step 3). `read` is true once the list answered: a stored ref it lacks is then
 * missing, not merely unknown.
 */
export function usePenaltyEntries(tournamentId: string): {
  entries: PenaltyEntry[];
  read: boolean;
} {
  const [entries, setEntries] = useState<PenaltyEntry[]>([]);
  const [read, setRead] = useState(false);

  useEffect(() => {
    void apiRequest<{ penalty_ruleset_entries?: PenaltyEntry[] }>(
      apiUrl,
      `/api/v1/tournaments/${tournamentId}/penalty-ruleset`,
    ).then((r) => {
      const list = [...(r.ok ? (r.data.penalty_ruleset_entries ?? []) : [])];
      list.sort(comparePenaltyEntries);
      setEntries(list);
      setRead(r.ok);
    });
  }, [tournamentId]);

  return { entries, read };
}
