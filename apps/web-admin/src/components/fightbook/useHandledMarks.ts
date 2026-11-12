'use client';

import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import type { SparFlagListItem } from '@myclash/types';
import { apiRequest } from '@myclash/api-client';
import { useI18n } from '@myclash/next-i18n/client';
import { getPublicApiUrl } from '@/lib/api-url';
import { errorOutcome, type Outcome } from '@/components/PageAlert';
import { flagHandledPath, type FlagScope } from './spar-flag-paths';

/**
 * The Handled box. The race handled here: a second tick on a box while its first write runs. A
 * box whose write is in flight is in `marking` and the row disables it, so one flag never has two
 * writes racing. The box moves at once; a failed write puts back the value it had before the tick.
 */
export function useHandledMarks(
  scope: FlagScope,
  setItems: Dispatch<SetStateAction<SparFlagListItem[] | null>>,
  setOutcome: (outcome: Outcome | null) => void,
) {
  const { t } = useI18n();
  const [marking, setMarking] = useState<ReadonlySet<string>>(new Set());

  const setHandled = useCallback(
    async (id: string, handled: boolean) => {
      const patch = (value: boolean) =>
        setItems((held) => held?.map((i) => (i.id === id ? { ...i, handled: value } : i)) ?? null);
      setOutcome(null);
      setMarking((s) => new Set(s).add(id));
      patch(handled);
      const r = await apiRequest<void>(getPublicApiUrl(), flagHandledPath(scope, id), {
        method: handled ? 'PUT' : 'DELETE',
      });
      if (!r.ok) {
        patch(!handled);
        setOutcome(errorOutcome(t('admin.fightBookFlags.handledFailed')));
      }
      setMarking((s) => {
        const rest = new Set(s);
        rest.delete(id);
        return rest;
      });
    },
    [scope, setItems, setOutcome, t],
  );

  return { marking, setHandled };
}
