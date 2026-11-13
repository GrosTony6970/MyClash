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

type SetHeld = Dispatch<SetStateAction<Held | null>>;
type SetFailure = Dispatch<SetStateAction<QrCodeState['failure']>>;

/** Is the panel up? Read by a mint's answer, which can land after a closing or an unmount. */
function usePanelUp(open: boolean) {
  const panelUp = useRef(false);
  useEffect(() => {
    panelUp.current = open;
    return () => void (panelUp.current = false); // at each opening, closing and unmount
  }, [open]);
  return panelUp;
}

/** The answer of the mint out: the code to hold, the failure, or a sign-in while the panel is up. */
function land(
  answer: Awaited<ReturnType<typeof mint>>,
  panelUp: boolean,
  setHeld: SetHeld,
  setFailure: SetFailure,
) {
  if (answer === 'sign-in') {
    if (panelUp) signInAgainHere();
    return;
  }
  setHeld('held' in answer ? answer.held : null);
  if ('failure' in answer) setFailure(answer.failure);
}

/** The one mint out and its four writers (see `useQrCode`). */
function useMintFlight(apiUrl: string, open: boolean, setHeld: SetHeld, setFailure: SetFailure) {
  const flight = useRef<Flight | null>(null);
  const lastId = useRef(0);
  const panelUp = usePanelUp(open);

  const giveUp = useCallback(() => {
    clearTimeout(flight.current?.timer);
    flight.current = null;
    setFailure('failed');
    setHeld(null);
  }, [setFailure, setHeld]);

  /**
   * At a wake, by the wall clock (timers stop while a phone sleeps): a mint out 10 s is given up,
   * and a younger one gets its timer re-armed for what is left of its 10 s.
   */
  const recheck = useCallback(() => {
    const out = flight.current;
    if (!out) return;
    const rest = MINT_GIVE_UP_MS - (Date.now() - out.startedWall);
    if (rest <= 0) return giveUp();
    clearTimeout(out.timer);
    out.timer = setTimeout(giveUp, rest);
  }, [giveUp]);

  /**
   * Mints unless one is out. One out 10 s by the wall clock is dropped with no failure: an opening
   * after a sleep finds one, and so would a re-run after an `apiUrl` change or a wall clock set
   * forward.
   */
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
      land(answer, panelUp.current, setHeld, setFailure);
    });
  }, [apiUrl, giveUp, panelUp, setHeld, setFailure]);
  return { send, recheck };
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
 * the panel shows a code before a failure. (3) A wake reads the wall clock, because timers stop
 * while a phone sleeps: a mint out 10 s is given up there, and the effect then stops on the
 * failure; a younger mint gets its timer re-armed for what is left of its 10 s, and the wake's
 * renewal finds it out and sends nothing. (4) An opening sends nothing while a mint is out and
 * drops, without a failure, one out 10 s by the wall clock, then mints; a closing keeps the mint,
 * so its answer is the held code. `send` is the one owner of "nothing while a mint is out". Every
 * give-up clears that mint's timer, and a re-arm clears the one it replaces: that is the timer's
 * one guard.
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
  const { send, recheck } = useMintFlight(apiUrl, open, setHeld, setFailure);

  useEffect(() => {
    if (!open) return;
    const wake = () => {
      if (document.visibilityState !== 'visible') return;
      recheck();
      setHeld((h) => (h && left(h) > RENEW_MARGIN_MS ? h : null));
      setRound((n) => n + 1);
    };
    document.addEventListener('visibilitychange', wake);
    return () => document.removeEventListener('visibilitychange', wake);
  }, [open, recheck]);

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
