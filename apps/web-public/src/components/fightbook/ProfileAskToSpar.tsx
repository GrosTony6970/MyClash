'use client';

import { useEffect, useState } from 'react';
import { fetchMe } from '@myclash/api-client';
import { readAskableFighter } from '@/lib/fightbook/read-fightbook';
import { AskToSpar } from './AskToSpar';
import { FavouriteHeart } from './FavouriteHeart';

/**
 * The "Ask to spar" button, and the heart beside it, on a public fighter profile. The page is public and server-rendered, so
 * the button is never in its data: it loads in the browser, and only for a signed-in fighter.
 * `/me` is asked once; `askable` is read only on `claimed`. Any other answer (a visitor who is not
 * signed in, a guest, a 401, a 403, a failure, a bad shape, `askable: false`) draws nothing, and a
 * failed `/me` never sends anyone to sign in.
 */
export function ProfileAskToSpar(props: { fighterId: string; name: string; apiUrl: string }) {
  const { fighterId, apiUrl } = props;
  const [askable, setAskable] = useState<{ favourite: boolean } | null>(null);

  useEffect(() => {
    if (!fighterId) return;
    const controller = new AbortController();
    void (async () => {
      const me = await fetchMe(apiUrl, { signal: controller.signal });
      if (!me.ok || me.data.type !== 'claimed') return;
      const answer = await readAskableFighter(apiUrl, fighterId, controller.signal);
      if (answer.kind === 'data' && answer.data.askable) {
        setAskable({ favourite: answer.data.favourite });
      }
    })();
    return () => controller.abort();
  }, [fighterId, apiUrl]);

  if (askable === null) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <AskToSpar receiverGlobalPersonId={fighterId} name={props.name} apiUrl={apiUrl} />
      <FavouriteHeart
        apiUrl={apiUrl}
        globalPersonId={fighterId}
        name={props.name}
        favourite={askable.favourite}
      />
    </div>
  );
}
