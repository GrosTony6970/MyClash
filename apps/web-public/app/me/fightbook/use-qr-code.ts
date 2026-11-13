'use client';

import { useEffect, useState } from 'react';
import type { FightBookQrCode } from '@myclash/types';
import { writeFightBook } from '@/lib/fightbook/read-fightbook';
import { signInAgainHere } from '@/lib/sign-in-return';

/** A code works for five minutes by the SERVER's clock (ruling 711). */
const CODE_LIFETIME_MS = 5 * 60_000;
/** A new code is asked for when less than this remains. */
const RENEW_MARGIN_MS = 30_000;

type Held = { code: string; endsAt: number };
export type QrCodeState = {
  code: string | null;
  failure: 'failed' | 'throttled' | null;
  retry: () => void;
};

/**
 * The code "My FightBook QR" shows. The API answers `expiresAt` but no server time, so
 * `expiresAt - Date.now()` would carry whatever error the phone's clock has. The lifetime is the
 * ruling's five minutes, counted from the answer on the monotonic clock (`performance.now`) and
 * waited out with a timer: neither moves when the wall clock is set. The held code outlives the
 * panel (this hook lives in the parent), so opening and closing it reuses a code with more than
 * 30 s left and mints nothing. Two writers are named: a renewal timer and a retry tap both mint;
 * each mint is dropped when the panel closes or a newer run starts (`cancelled`).
 */
export function useQrCode(apiUrl: string, open: boolean): QrCodeState {
  const [held, setHeld] = useState<Held | null>(null);
  const [failure, setFailure] = useState<QrCodeState['failure']>(null);
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (!open) return;
    const left = held ? held.endsAt - performance.now() - RENEW_MARGIN_MS : 0;
    if (held && left > 0) {
      const timer = setTimeout(() => setRound((n) => n + 1), left);
      return () => clearTimeout(timer);
    }
    let cancelled = false;
    void writeFightBook<FightBookQrCode>(apiUrl, '/api/v1/me/fightbook/qr', 'POST').then((res) => {
      if (cancelled) return;
      if (!res.ok) {
        if (res.status === 401) return signInAgainHere();
        setHeld(null);
        return setFailure(res.status === 429 ? 'throttled' : 'failed');
      }
      if (typeof res.data?.code !== 'string') {
        setHeld(null);
        return setFailure('failed');
      }
      setFailure(null);
      setHeld({ code: res.data.code, endsAt: performance.now() + CODE_LIFETIME_MS });
    });
    return () => {
      cancelled = true;
    };
  }, [apiUrl, open, held, round]);

  const retry = () => {
    setFailure(null);
    setRound((n) => n + 1);
  };
  return { code: held?.code ?? null, failure, retry };
}
