'use client';

import { useEffect, useState } from 'react';
import type { ApiFailure } from '@myclash/api-client';
import { useI18n } from '@myclash/next-i18n/client';
import { refusedUndoWords } from '../lib/refused-undo';
import { watchUndone } from '../lib/watch-undone';

interface RememberedUndosProps {
  engine: Parameters<typeof watchUndone>[0]['engine'];
  apiUrl: string;
  matchId: string;
  onSettled: () => void;
}

/**
 * The undos the tablet wrote down, while a bout screen is open: settled with the
 * server (ruling 350), and said when the server refused one of THIS bout
 * (ruling 354). The entry is on the list again, and the referee took it off:
 * the notice says why, until he closes it.
 */
export function RememberedUndos({ engine, apiUrl, matchId, onSettled }: RememberedUndosProps) {
  const { t } = useI18n();
  const [refused, setRefused] = useState<ApiFailure | null>(null);

  useEffect(
    () => watchUndone({ engine, apiUrl, matchId, onSettled, onRefused: setRefused, win: window }),
    [engine, apiUrl, matchId, onSettled],
  );

  if (!refused) return null;
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 bg-warning px-4 py-2 text-warning-foreground"
    >
      <span className="text-sm font-semibold">{refusedUndoWords(refused, t)}</span>
      <button
        type="button"
        onClick={() => setRefused(null)}
        className="min-h-[44px] shrink-0 rounded-lg border border-warning-foreground/40 px-3 text-xs font-bold uppercase"
      >
        {t('scoring.result.close')}
      </button>
    </div>
  );
}
