'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { FightBookQrCode } from '@myclash/types';
import { writeFightBook } from '@/lib/fightbook/read-fightbook';
import { signInAgainHere } from '@/lib/sign-in-return';

/** A code works for five minutes by the SERVER's clock (ruling 711). */
const CODE_LIFETIME_MS = 5 * 60_000;
/** A new code is asked for when less than this remains. */
const RENEW_MARGIN_MS = 30_000;
/** A mint with no answer after this long, on either clock, counts as failed (ruling 754). */
const MINT_GIVE_UP_MS = 10_000;

/** A code and when it ends on each of the phone's two clocks, both counted from the answer. */
type Held = { code: string; monoEnd: number; wallEnd: number };
/** The one mint out: its id, when it left by the wall clock, and its give-up timer. */
type Flight = { id: number; startedWall: number; timer: ReturnType<typeof setTimeout> };
export type QrCodeState = {
  code: string | null;
  failure: 'failed' | 'throttled' | null;
  retry: () => void;
};

/** What is left of a held code: the lesser of what its two clocks say. */
const left = (held: Held) => Math.min(held.monoEnd - performance.now(), held.wallEnd - Date.now());

/** One mint: the code with both clocks read at the answer, the failure, or a 401 (sign in). */
async function mint(
  apiUrl: string,
): Promise<{ held: Held } | { failure: 'failed' | 'throttled' } | 'sign-in'> {
  const res = await writeFightBook<FightBookQrCode>(apiUrl, '/api/v1/me/fightbook/qr', 'POST');
  if (!res.ok) {
    if (res.status === 401) return 'sign-in';
    return { failure: res.status === 429 ? 'throttled' : 'failed' };
  }
  if (typeof res.data?.code !== 'string') return { failure: 'failed' };
  const [mono, wall] = [performance.now(), Date.now()];
  return {
    held: {
      code: res.data.code,
      monoEnd: mono + CODE_LIFETIME_MS,
      wallEnd: wall + CODE_LIFETIME_MS,
    },
  };
}

/** The one mint out and its four writers (see `useQrCode`). */
function useMintFlight(
  apiUrl: string,
  open: boolean,
  setHeld: Dispatch<SetStateAction<Held | null>>,
  setFailure: Dispatch<SetStateAction<QrCodeState['failure']>>,
) {
  const flight = useRef<Flight | null>(null);
  const lastId = useRef(0);
  const panelUp = useRef(false);
  useEffect(() => {
    panelUp.current = open;
    return () => void (panelUp.current = false); // unmounted, the panel is gone too
  }, [open]);

  const giveUp = useCallback(() => {
    clearTimeout(flight.current?.timer);
    flight.current = null;
    setFailure('failed');
    setHeld(null);
  }, [setFailure, setHeld]);

  /** At a wake: a mint out 10 s by the wall clock is given up (timers stop while a phone sleeps). */
  const giveUpStale = useCallback(() => {
    const out = flight.current;
    if (out && Date.now() - out.startedWall >= MINT_GIVE_UP_MS) giveUp();
  }, [giveUp]);

  /** Mints unless one is out. Only an opening after a sleep finds one out 10 s: it is dropped. */
  const send = useCallback(() => {
    const out = flight.current;
    if (out && Date.now() - out.startedWall < MINT_GIVE_UP_MS) return;
    clearTimeout(out?.timer);
    const id = (lastId.current += 1);
    flight.current = { id, startedWall: Date.now(), timer: setTimeout(giveUp, MINT_GIVE_UP_MS) };
    void mint(apiUrl).then((answer) => {
      if (flight.current?.id !== id) return;
      clearTimeout(flight.current.timer);
      flight.current = null;
      if (answer === 'sign-in') {
        if (panelUp.current) signInAgainHere();
        return;
      }
      setHeld('held' in answer ? answer.held : null);
      if ('failure' in answer) setFailure(answer.failure);
    });
  }, [apiUrl, giveUp, setHeld, setFailure]);
  return { send, giveUpStale };
}

/**
 * The code "My FightBook QR" shows. The API answers `expiresAt` but no server time, so
 * `expiresAt - Date.now()` would carry whatever error the phone's clock has. The lifetime is the
 * ruling's five minutes, counted from the answer on BOTH clocks (Ruling P): the monotonic one
 * (`performance.now`) does not move when the wall clock is set, and the wall clock (`Date.now`)
 * keeps running while the phone sleeps, when timers pause and, on WebKit and on Chromium on macOS,
 * the monotonic clock stops too. The code is stale when EITHER says less than 30 s remain: a wall
 * clock set forward costs one extra mint, one set back is covered by the monotonic clock. The
 * hook looks again when the page becomes visible (a phone waking) and when the panel opens.
 *
 * The held code outlives the panel (this hook lives in the parent), so opening and closing it
 * reuses a code with more than 30 s left and mints nothing. A failure belongs to the opening it
 * happened in: it stops the minting until a tap on "Try again" or the next opening.
 *
 * At most one mint is out (ruling 754). The mint out lives in `flight` (`useMintFlight`), a ref
 * that outlives the effect's re-runs, with its id and its 10 s timer. Four writers race. (1) The
 * mint's answer acts only while `flight` still holds its id, so a given-up mint's late answer shows
 * nothing and frees nothing; it clears its own timer. A 401 sends to sign in only while the panel
 * is up. (2) The 10 s timer gives the mint up: the failure shows and the held code goes, because
 * the panel shows a code before a failure. (3) A wake gives up a mint out 10 s by the wall clock
 * (timers stop while a phone sleeps); its renewal then finds any other mint out and sends nothing.
 * (4) An opening sends nothing while a mint is out and drops, without a failure, one out 10 s by
 * the wall clock, then mints; a closing keeps the mint, so its answer is the held code. `send` is
 * the one owner of "nothing while a mint is out". Every give-up clears that mint's timer: that is
 * the timer's one guard.
 */
export function useQrCode(apiUrl: string, open: boolean): QrCodeState {
  const [held, setHeld] = useState<Held | null>(null);
  const [failure, setFailure] = useState<QrCodeState['failure']>(null);
  const [round, setRound] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    setFailure(null);
  }
  const { send, giveUpStale } = useMintFlight(apiUrl, open, setHeld, setFailure);

  useEffect(() => {
    if (!open) return;
    const wake = () => {
      if (document.visibilityState !== 'visible') return;
      giveUpStale();
      setHeld((h) => (h && left(h) > RENEW_MARGIN_MS ? h : null));
      setRound((n) => n + 1);
    };
    document.addEventListener('visibilitychange', wake);
    return () => document.removeEventListener('visibilitychange', wake);
  }, [open, giveUpStale]);

  useEffect(() => {
    if (!open || failure) return;
    const wait = held ? left(held) - RENEW_MARGIN_MS : 0;
    if (held && wait > 0) {
      const timer = setTimeout(() => setRound((n) => n + 1), wait);
      return () => clearTimeout(timer);
    }
    send();
  }, [open, held, failure, round, send]);

  const retry = () => {
    setFailure(null);
    setRound((n) => n + 1);
  };
  return { code: held?.code ?? null, failure, retry };
}
