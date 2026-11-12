'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import type { FindCard } from '@myclash/types';
import { EmptyState, Spinner } from '@myclash/ui';
import { ReadFailed } from '@/components/me/ReadFailed';
import { readFavourites } from '@/lib/fightbook/read-fightbook';
import { signInAgainHere } from '@/lib/sign-in-return';
import { FindCards } from './FindCards';

/** My favourites, read when the tab opens; `null` while reading, `'failed'` when the read failed. */
function useFavourites(apiUrl: string) {
  const [cards, setCards] = useState<FindCard[] | 'failed' | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void readFavourites(apiUrl, controller.signal).then((read) => {
      if (controller.signal.aborted || read.kind === 'aborted') return;
      if (read.kind === 'signin') return signInAgainHere();
      setCards(read.kind === 'data' ? read.data : 'failed');
    });
    return () => controller.abort();
  }, [apiUrl, attempt]);
  const retry = () => {
    setCards(null);
    setAttempt((n) => n + 1);
  };
  /** A heart removed here drops its card; the write has already won. */
  const drop = (globalPersonId: string) =>
    setCards((current) =>
      Array.isArray(current)
        ? current.filter((c) => c.fighter.globalPersonId !== globalPersonId)
        : current,
    );
  return { cards, retry, drop };
}

/**
 * The Favourites tab (`?tab=favourites`, ruling 679): the fighters I hearted who can still be
 * asked, by name, each with their heart and "Ask to spar". Removing a heart drops the card. A
 * favourite who is off FightBook, or whom I blocked, is not listed (the API leaves them out).
 * `onHearted` tells the page, so My spars shows the same heart.
 */
export function FavouritesTab(props: {
  apiUrl: string;
  onSent: () => void;
  onHearted: (globalPersonId: string, favourite: boolean) => void;
}) {
  const { t } = useI18n();
  const { cards, retry, drop } = useFavourites(props.apiUrl);
  if (cards === null) return <Spinner label={t('common.loading')} />;
  if (cards === 'failed') {
    return <ReadFailed title={t('publicApp.fightBook.favourites.failed')} onRetry={retry} />;
  }
  if (cards.length === 0) {
    return (
      <EmptyState
        title={t('publicApp.fightBook.favourites.empty')}
        description={t('publicApp.fightBook.favourites.emptyDescription')}
      />
    );
  }
  return (
    <FindCards
      cards={cards}
      apiUrl={props.apiUrl}
      onSent={props.onSent}
      onHearted={(id, favourite) => {
        props.onHearted(id, favourite);
        if (!favourite) drop(id);
      }}
    />
  );
}
