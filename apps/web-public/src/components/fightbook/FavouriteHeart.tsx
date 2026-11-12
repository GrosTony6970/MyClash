'use client';

import { useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import { FAVOURITES_MAX } from '@myclash/types';
import { writeFightBook } from '@/lib/fightbook/read-fightbook';
import { sparRefusalKey } from '@/lib/fightbook/refusal';

interface HeartProps {
  apiUrl: string;
  globalPersonId: string;
  name: string;
  favourite: boolean;
  onChanged?: (favourite: boolean) => void;
}

/**
 * The heart's state and its write: `shown` (optimistic), `busy`, and the sentence of a refusal.
 * Two writers meet here: my tap and the page's data (`favourite`, which a re-read or a patch can
 * change). The page's value wins whenever no write is running; while one runs, the tap's value
 * stays, so a quiet re-read landing before the answer cannot flip the heart back.
 */
function useHeart(props: HeartProps) {
  const { t } = useI18n();
  const [shown, setShown] = useState(props.favourite);
  const [seen, setSeen] = useState(props.favourite);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  if (!busy && seen !== props.favourite) {
    setSeen(props.favourite);
    setShown(props.favourite);
  }

  const toggle = async () => {
    if (busy) return;
    const next = !shown;
    setBusy(true);
    setRefusal(null);
    setShown(next);
    const path = `/api/v1/me/fightbook/favourites/${props.globalPersonId}`;
    const res = await writeFightBook(props.apiUrl, path, next ? 'PUT' : 'DELETE');
    setBusy(false);
    if (res.ok) {
      props.onChanged?.(next);
    } else {
      setShown(!next);
      // `max` fills the favourites_full sentence; every other refusal has no placeholder.
      setRefusal(t(sparRefusalKey(res.code), { max: FAVOURITES_MAX }));
    }
  };
  return { shown, busy, refusal, toggle };
}

/**
 * The private heart (ruling 679): a toggle that adds a fighter to my favourites or removes them.
 * Nobody is told. It flips at once and flips back, with a sentence, when the write is refused.
 * One owner: every surface (Find, My spars, Favourites, the profile) renders this component.
 * `onChanged` tells the page the write won, so it patches its own lists.
 */
export function FavouriteHeart(props: HeartProps) {
  const { t } = useI18n();
  const { shown, busy, refusal, toggle } = useHeart(props);
  const label = shown
    ? t('publicApp.fightBook.favourites.remove', { name: props.name })
    : t('publicApp.fightBook.favourites.add', { name: props.name });
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        aria-pressed={shown}
        aria-label={label}
        title={label}
        disabled={busy}
        onClick={() => void toggle()}
        className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-xl hover:bg-background disabled:opacity-60 ${shown ? 'text-danger' : 'text-muted'}`}
      >
        <span aria-hidden="true">{shown ? '♥' : '♡'}</span>
      </button>
      {refusal ? (
        <span role="alert" className="text-xs text-danger">
          {refusal}
        </span>
      ) : null}
    </span>
  );
}
