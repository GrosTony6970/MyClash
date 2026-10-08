'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { signInPath } from '../lib/nav';
import { hearSessionEnded } from '../offline/caller-refusal';

/**
 * A tap the server answers "nobody is signed in" leaves the bout for the
 * sign-in screen (ruling 342), which says the hits this tablet still holds.
 * The hits stay in the queue: a sign-in loads the pad again, and the bout
 * screen sends them when it opens.
 *
 * The race is an answer that lands after the screen has left: the stop handed
 * back by `hearSessionEnded` runs at the unmount, so nobody is moved then.
 */
export function useSignInWhenSessionEnded(): void {
  const router = useRouter();
  useEffect(
    () => hearSessionEnded(() => router.replace(signInPath(window.location.pathname))),
    [router],
  );
}
