'use client';

import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import type { UndoNotice } from '../offline/db';
import { noticesOf, saidNotices } from '../offline/undo-notices';
import { undoNoticeLines } from '../lib/refused-undo';
import { watchUndone } from '../lib/watch-undone';

interface RememberedUndosProps {
  engine: Parameters<typeof watchUndone>[0]['engine'];
  apiUrl: string;
  matchId: string;
  onSettled: () => void;
}

/**
 * The undos the tablet wrote down, while a bout screen is open: settled with the
 * server (ruling 350), and said when one of THIS bout was not carried out: the
 * server refused it (ruling 354), nobody could ask for a day (ruling 365), or
 * the bout ended meanwhile (ruling 366). The entry is on the list again, and
 * the referee took it off: the notice says why, until he closes it.
 *
 * What is said was written down by the settle, with its bout. So an undo of
 * this bout settled while another screen was open is said here, when this
 * screen opens (ruling 364).
 *
 * The race is a read that started before the Close and lands after it: it
 * would show the rows again. The ids he closed are left out of every read.
 */
export function RememberedUndos({ engine, apiUrl, matchId, onSettled }: RememberedUndosProps) {
  const { t } = useI18n();
  const [notices, setNotices] = useState<UndoNotice[]>([]);
  const closed = useRef(new Set<string>());

  useEffect(() => {
    let gone = false;
    const read = () => {
      void noticesOf(matchId).then((rows) => {
        if (!gone) setNotices(rows.filter((row) => !closed.current.has(row.clientUuid)));
      });
    };
    read();
    const stop = watchUndone({ engine, apiUrl, onSettled, onRan: read, win: window });
    return () => {
      gone = true;
      stop();
    };
  }, [engine, apiUrl, matchId, onSettled]);

  if (notices.length === 0) return null;
  const close = () => {
    for (const notice of notices) closed.current.add(notice.clientUuid);
    setNotices([]);
    void saidNotices(notices);
  };
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 bg-warning px-4 py-2 text-warning-foreground"
    >
      <div className="text-sm font-semibold">
        {undoNoticeLines(notices, t).map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
      <button
        type="button"
        onClick={close}
        className="min-h-[44px] shrink-0 rounded-lg border border-warning-foreground/40 px-3 text-xs font-bold uppercase"
      >
        {t('scoring.result.close')}
      </button>
    </div>
  );
}
