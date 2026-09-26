'use client';

/**
 * useRefereeWrite — a PUT to a referee write door (ADR-016) on a screen with no picker:
 * the Pools page's per-bout and Pool-strip dropdowns.
 *
 * A refusal of the one checker is kept to show (`RefereeWriteNotice`); an amber one can be
 * confirmed, which sends the same body again with `confirm: true`. Any other failure is
 * said in words. Those writes used to fail with a console line and a refetch: the pick
 * just snapped back.
 *
 * `after` runs once the write settles, with the answer or with null when it did not land
 * (the caller undoes its optimistic change); a sentence it returns is shown as a note. An
 * amber refusal waits for the organiser: Assign anyway settles it with the answer, Cancel
 * with null. Undone at once, the pick would come back stale after a confirm.
 */
import { apiRequest } from '@myclash/api-client';
import { useI18n } from '@myclash/next-i18n/client';
import { useCallback, useState } from 'react';
import { getPublicApiUrl } from '@/lib/api-url';
import { assignFailureText, refereeRefusal, type RefereeRefusal } from '@/lib/referee-reasons';

const apiUrl = getPublicApiUrl();

type After<T> = (answer: T | null) => string | void;

interface Refused {
  refusal: RefereeRefusal;
  path: string;
  body: Record<string, unknown>;
  after: After<unknown>;
}

export interface RefereeWrite {
  put: <T>(path: string, body: Record<string, unknown>, after: After<T>) => Promise<void>;
  confirm: () => void;
  dismiss: () => void;
  refusal: RefereeRefusal | null;
  note: string | null;
  error: string | null;
  busy: boolean;
}

export function useRefereeWrite(): RefereeWrite {
  const { t } = useI18n();
  const [refused, setRefused] = useState<Refused | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const put = useCallback(
    async <T>(path: string, body: Record<string, unknown>, after: After<T>) => {
      setBusy(true);
      setRefused(null);
      setNote(null);
      setError(null);
      try {
        const r = await apiRequest<T>(apiUrl, path, { method: 'PUT', body });
        if (r.ok) {
          const said = after(r.data);
          setNote(typeof said === 'string' ? said : null);
          return;
        }
        const refusal = refereeRefusal(r);
        if (refusal) setRefused({ refusal, path, body, after: after as After<unknown> });
        else setError(assignFailureText(t, r, t('organizer.poolsPage.refereesAssignFailed')));
        // An amber pick stays on screen while the organiser decides: Assign anyway keeps
        // it, Cancel undoes it (`dismiss`). Anything else did not land: undo it now.
        if (refusal?.level !== 'discouraged') after(null);
      } finally {
        setBusy(false);
      }
    },
    [t],
  );

  const confirm = useCallback(() => {
    if (refused) void put(refused.path, { ...refused.body, confirm: true }, refused.after);
  }, [refused, put]);

  const dismiss = useCallback(() => {
    if (refused?.refusal.level === 'discouraged') refused.after(null);
    setRefused(null);
    setError(null);
  }, [refused]);

  return { put, confirm, dismiss, refusal: refused?.refusal ?? null, note, error, busy };
}
