'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AfterblowButton, CleanButton, TournamentScoringConfig } from '@myclash/types';
import { computeAfterblowDeltas } from '@myclash/types';

export type ExchangeSide = 'red' | 'blue';
export type NoExchangeReason = 'out_of_bounds' | 'simultaneous_stop' | 'no_valid_hit' | 'other';

interface PendingExchange {
  type: 'clean' | 'afterblow' | 'double' | 'no_exchange';
  firstStrikerColor?: ExchangeSide;
  firstStrikeValue?: number;
  afterblowValue?: number;
  noExchangeReason?: NoExchangeReason;
}

export interface UseScoringSubmitArgs {
  apiUrl: string;
  matchId: string;
  nextSequence: number;
  /** Clock active ms at submission time — recorded BE-side per exchange. */
  clockTimeMs: number | null;
  config: TournamentScoringConfig;
  onExchangeRecorded?: (exchangeId: string) => void;
}

export interface UseScoringSubmitResult {
  submitting: boolean;
  error: string | null;
  setError: (value: string | null) => void;
  submitClean: (side: ExchangeSide, btn: CleanButton) => void;
  submitAfterblow: (side: ExchangeSide, btn: AfterblowButton) => void;
  submitDouble: () => void;
  submitNoExchange: (reason: NoExchangeReason) => void;
}

/**
 * Shared scoring submission logic, extracted from ScoringPad so that
 * the new per-side ScoringColumn + the centre-column Double/No-exchange
 * buttons can all share one submit pipeline and one sequence/clock
 * timestamp.
 */
export function useScoringSubmit({
  apiUrl,
  matchId,
  nextSequence,
  clockTimeMs,
  config,
  onExchangeRecorded,
}: UseScoringSubmitArgs): UseScoringSubmitResult {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sequenceRef = useRef(nextSequence);

  useEffect(() => {
    sequenceRef.current = nextSequence;
  }, [nextSequence]);

  const submit = useCallback(
    async (exchange: PendingExchange) => {
      setSubmitting(true);
      setError(null);
      try {
        const res = await fetch(`${apiUrl}/api/v1/matches/${matchId}/exchanges`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            clientUuid: crypto.randomUUID(),
            sequence: sequenceRef.current,
            type: exchange.type,
            occurredAt: new Date().toISOString(),
            clockTimeMs,
            firstStrikerColor: exchange.firstStrikerColor ?? null,
            firstStrikeValue: exchange.firstStrikeValue ?? null,
            afterblowValue: exchange.afterblowValue ?? null,
            noExchangeReason: exchange.noExchangeReason ?? null,
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { message?: string };
          throw new Error(body.message ?? 'Failed to record exchange');
        }
        const body = (await res.json()) as { id: string };
        onExchangeRecorded?.(body.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Network error');
      } finally {
        setSubmitting(false);
      }
    },
    [apiUrl, matchId, clockTimeMs, onExchangeRecorded],
  );

  const submitClean = useCallback(
    (side: ExchangeSide, btn: CleanButton) => {
      void submit({ type: 'clean', firstStrikerColor: side, firstStrikeValue: btn.value });
    },
    [submit],
  );

  const submitAfterblow = useCallback(
    (side: ExchangeSide, btn: AfterblowButton) => {
      const { attackerDelta, defenderDelta } = computeAfterblowDeltas(
        config.afterblowMode,
        btn.attackerPts,
        btn.defenderPts,
      );
      void submit({
        type: 'afterblow',
        firstStrikerColor: side,
        firstStrikeValue: attackerDelta,
        afterblowValue: defenderDelta,
      });
    },
    [submit, config.afterblowMode],
  );

  const submitDouble = useCallback(() => {
    void submit({ type: 'double' });
  }, [submit]);

  const submitNoExchange = useCallback(
    (reason: NoExchangeReason) => {
      void submit({ type: 'no_exchange', noExchangeReason: reason });
    },
    [submit],
  );

  return {
    submitting,
    error,
    setError,
    submitClean,
    submitAfterblow,
    submitDouble,
    submitNoExchange,
  };
}
