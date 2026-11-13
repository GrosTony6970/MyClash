'use client';

import { useEffect, useState } from 'react';
import type { FightBookQrCode } from '@myclash/types';
import { writeFightBook } from '@/lib/fightbook/read-fightbook';
import { signInAgainHere } from '@/lib/sign-in-return';

/** A code works for five minutes by the SERVER's clock (ruling 711). */
const CODE_LIFETIME_MS = 5 * 60_000;
/** A new code is asked for when less than this remains. */
const RENEW_MARGIN_MS = 30_000;

/** A code and when it ends on each of the phone's two clocks, both counted from the answer. */
type Held = { code: string; monoEnd: number; wallEnd: number };
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
 * happened in: it stops the minting until a tap on "Try again" or the next opening. Two writers
 * are named: a renewal (timer, wake or opening) and a retry tap both mint; each mint is dropped
 * when the panel closes or a newer run starts (`cancelled`).
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

  useEffect(() => {
    if (!open) return;
    const wake = () => {
      if (document.visibilityState !== 'visible') return;
      setHeld((h) => (h && left(h) > RENEW_MARGIN_MS ? h : null));
      setRound((n) => n + 1);
    };
    document.addEventListener('visibilitychange', wake);
    return () => document.removeEventListener('visibilitychange', wake);
  }, [open]);

  useEffect(() => {
    if (!open || failure) return;
    const wait = held ? left(held) - RENEW_MARGIN_MS : 0;
    if (held && wait > 0) {
      const timer = setTimeout(() => setRound((n) => n + 1), wait);
      return () => clearTimeout(timer);
    }
    let cancelled = false;
    void mint(apiUrl).then((minted) => {
      if (cancelled) return;
      if (minted === 'sign-in') return signInAgainHere();
      setHeld('held' in minted ? minted.held : null);
      if ('failure' in minted) setFailure(minted.failure);
    });
    return () => {
      cancelled = true;
    };
  }, [apiUrl, open, held, failure, round]);

  const retry = () => {
    setFailure(null);
    setRound((n) => n + 1);
  };
  return { code: held?.code ?? null, failure, retry };
}
