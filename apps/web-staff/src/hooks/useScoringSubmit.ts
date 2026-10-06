'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AfterblowButton, CleanButton } from '@myclash/types';
import type { BoutNames } from '../offline/db';
import { enqueue } from '../offline/outbox';
import type { SyncEngine } from '../offline/sync';

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
  matchId: string;
  nextSequence: number;
  /** Clock active ms at submission time — recorded BE-side per exchange. */
  clockTimeMs: number | null;
  /** The bout in words, queued with each hit and card so a held one can be named (ruling 243). */
  bout: BoutNames;
  /** Durable-sync engine. Exchanges are written to the IndexedDB outbox and POSTed
   *  by the engine (online → immediate; offline → queued until reconnect). */
  syncEngine?: SyncEngine | null;
  onExchangeRecorded?: (exchangeId?: string) => void;
}

export interface UseScoringSubmitResult {
  /** Handed on to the card column, which queues its own rows. */
  bout: BoutNames;
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
  matchId,
  nextSequence,
  clockTimeMs,
  bout,
  syncEngine,
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
        // Durable-first: write to the IndexedDB outbox, then let the SyncEngine POST
        // it. Online it syncs immediately; offline it stays queued and drains on
        // reconnect. clientUuid makes the POST idempotent (a re-drain answers the saved row).
        // The press does not wait for the send (ruling 316): the buttons come back
        // once the hit is on the tablet, whatever the queue or the wifi is doing.
        await enqueue({
          clientUuid: crypto.randomUUID(),
          matchId,
          sequence: sequenceRef.current,
          occurredAt: new Date().toISOString(),
          clockTimeMs,
          bout,
          ...exchange,
        });
        syncEngine?.sendBehind();
        // Moves the sequence on. The engine says the new count, which shows the
        // hit as provisional; the server is read once, when the send has ended.
        onExchangeRecorded?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to record exchange');
      } finally {
        setSubmitting(false);
      }
    },
    [matchId, clockTimeMs, bout, syncEngine, onExchangeRecorded],
  );

  const submitClean = useCallback(
    (side: ExchangeSide, btn: CleanButton) => {
      void submit({ type: 'clean', firstStrikerColor: side, firstStrikeValue: btn.value });
    },
    [submit],
  );

  const submitAfterblow = useCallback(
    (side: ExchangeSide, btn: AfterblowButton) => {
      // Send the RAW button values. The server applies the tournament's
      // afterblow mode when deriving scores (deductive nets the afterblow
      // against the attacker); storing raw preserves blow fidelity for stats.
      void submit({
        type: 'afterblow',
        firstStrikerColor: side,
        firstStrikeValue: btn.attackerPts,
        afterblowValue: btn.defenderPts,
      });
    },
    [submit],
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
    bout,
    submitting,
    error,
    setError,
    submitClean,
    submitAfterblow,
    submitDouble,
    submitNoExchange,
  };
}
