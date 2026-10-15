'use client';

/**
 * The Tournament an Event's page shows (quick win O7): the address's `?tournamentId`, then
 * the last one picked in this Event on this browser, then the first of `choices`. The choice
 * is derived in render; an effect writes it back into the address (query and hash kept: the
 * pages keep their tab in the hash) and remembers it.
 *
 * The race: `router.replace` lands a render or more after a click. Until then the click is a
 * `pending` value. An address that is still `ours` (the one the first click was made over, or
 * one this hook wrote for an earlier click, landing late) does not overrule it: two quick
 * clicks, t2 then back to t1, keep t1 when the write of t2 lands after it. The pick ends when
 * the address arrives at it, or moves to a Tournament nobody here wrote (a followed link):
 * then the address speaks again, a later link back to t1 included.
 *
 * `remember: false` neither reads nor writes the browser's memory (the roster opens on
 * every Tournament unless its address names one; operator, 2026-10-14).
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { forgetLanded, writeAddress } from '@/lib/address-write';
import {
  chooseTournament,
  rememberTournament,
  rememberedTournament,
} from '@/lib/tournament-choice';

interface Pending {
  value: string;
  ours: Array<string | null>;
}

export function useTournamentChoice(
  eventId: string,
  choices: readonly string[],
  { remember = true }: { remember?: boolean } = {},
): [string, (tournamentId: string) => void] {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromAddress = searchParams.get('tournamentId');
  const [pending, setPending] = useState<Pending | null>(null);
  useEffect(forgetLanded, [searchParams]);
  // The pick ends when the address MOVES onto it, or onto a word from outside. Not when it
  // merely equals it: t2 then back to t1 starts on t1, and the late write of t2 is to come.
  const [seen, setSeen] = useState(fromAddress);
  if (seen !== fromAddress) {
    setSeen(fromAddress);
    if (pending && (fromAddress === pending.value || !pending.ours.includes(fromAddress))) {
      setPending(null);
    }
  }

  const asked = pending && pending.ours.includes(fromAddress) ? pending.value : fromAddress;
  const chosen = chooseTournament(choices, asked, remember ? rememberedTournament(eventId) : null);

  useEffect(() => {
    if (!chosen) return;
    if (remember) rememberTournament(eventId, chosen);
    if (fromAddress === chosen) return;
    // Through the one door: a filter write still out stays in the address.
    writeAddress((href) => router.replace(href, { scroll: false }), { tournamentId: chosen });
  }, [chosen, fromAddress, eventId, remember, router]);

  const choose = useCallback(
    (tournamentId: string) =>
      setPending((prev) => ({
        value: tournamentId,
        // A pick still out may land later: its value is ours too.
        ours: prev ? [...prev.ours, prev.value] : [fromAddress],
      })),
    [fromAddress],
  );

  return [chosen, choose];
}
