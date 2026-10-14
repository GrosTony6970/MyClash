'use client';

/**
 * The Tournament an Event's page shows (quick win O7): the address's `?tournamentId`, then
 * the last one picked in this Event on this browser, then the first of `choices`. The choice
 * is derived in render; an effect writes it back into the address (query and hash kept: the
 * pages keep their tab in the hash) and remembers it.
 *
 * The race: `router.replace` lands a render or more after a click. Until then the click is a
 * `pending` value tied to the address it was made over; once the address moves (to the
 * click, or to a link that names another Tournament) the address speaks again.
 *
 * `remember: false` neither reads nor writes the browser's memory (the roster opens on
 * every Tournament unless its address names one; operator, 2026-10-14).
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  chooseTournament,
  rememberTournament,
  rememberedTournament,
  withTournament,
} from '@/lib/tournament-choice';

interface Pending {
  value: string;
  over: string | null;
}

export function useTournamentChoice(
  eventId: string,
  choices: readonly string[],
  { remember = true }: { remember?: boolean } = {},
): [string, (tournamentId: string) => void] {
  const router = useRouter();
  const fromAddress = useSearchParams().get('tournamentId');
  const [pending, setPending] = useState<Pending | null>(null);

  const asked = pending && pending.over === fromAddress ? pending.value : fromAddress;
  const chosen = chooseTournament(choices, asked, remember ? rememberedTournament(eventId) : null);

  useEffect(() => {
    if (!chosen) return;
    if (remember) rememberTournament(eventId, chosen);
    if (fromAddress === chosen) return;
    router.replace(withTournament(window.location.href, chosen), { scroll: false });
  }, [chosen, fromAddress, eventId, remember, router]);

  const choose = useCallback(
    (tournamentId: string) => setPending({ value: tournamentId, over: fromAddress }),
    [fromAddress],
  );

  return [chosen, choose];
}
