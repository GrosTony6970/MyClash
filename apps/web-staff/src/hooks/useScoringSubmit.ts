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
  /** The last press could not be written on the tablet. Cleared by the next press that is. */
  notSaved: boolean;
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
  const [notSaved, setNotSaved] = useState(false);
  const sequenceRef = useRef(nextSequence);

  useEffect(() => {
    sequenceRef.current = nextSequence;
  }, [nextSequence]);

  const submit = useCallback(
    async (exchange: PendingExchange) => {
      setSubmitting(true);
      // Durable-first: write to the IndexedDB outbox, then let the SyncEngine POST
      // it. Online it syncs immediately; offline it stays queued and drains on
      // reconnect. clientUuid makes the POST idempotent (a re-drain answers the saved row).
      // The press does not wait for the send (ruling 316): the buttons come back
      // once the hit is on the tablet, whatever the queue or the wifi is doing.
      const written = await writeHit(
        async () => {
          await enqueue({
            clientUuid: crypto.randomUUID(),
            matchId,
            sequence: sequenceRef.current,
            occurredAt: new Date().toISOString(),
            clockTimeMs,
            bout,
            ...exchange,
          });
        },
        syncEngine,
        onExchangeRecorded,
      );
      // The one writer: the alert stays until a press is written.
      setNotSaved(written === 'not_saved');
      setSubmitting(false);
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
    notSaved,
    submitClean,
    submitAfterblow,
    submitDouble,
    submitNoExchange,
  };
}

/**
 * One press, written on the tablet. Only then is a send asked for and the
 * sequence moved on: a hit the tablet could not write is not counted, and the
 * screen says so. The store's own words (Dexie's, in English) go to the
 * console, never to the official.
 */
export async function writeHit(
  write: () => Promise<void>,
  syncEngine: Pick<SyncEngine, 'sendBehind'> | null | undefined,
  onExchangeRecorded: (() => void) | undefined,
): Promise<'saved' | 'not_saved'> {
  try {
    await write();
  } catch (err) {
    console.error('[pad] a hit could not be written on the tablet', err);
    return 'not_saved';
  }
  syncEngine?.sendBehind();
  // Moves the sequence on. The engine says the new count, which shows the
  // hit as provisional; the server is read once, when the send has ended.
  onExchangeRecorded?.();
  return 'saved';
}
