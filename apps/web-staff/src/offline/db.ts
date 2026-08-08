/**
 * db.ts — Dexie (IndexedDB) schema for the scoring app offline store.
 *
 * Tables:
 *   outbox   — pending exchanges waiting to be synced to the server
 *   synced   — exchanges confirmed by the server (kept for reconciliation)
 *   rejected — exchanges the server refused, held for the operator to retry
 */

import Dexie, { type Table } from 'dexie';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ExchangeType = 'clean' | 'afterblow' | 'double' | 'no_exchange';
export type StrikerColor = 'red' | 'blue';

export interface OutboxEntry {
  /** Auto-incremented local PK — determines drain order. */
  id?: number;
  /** Client-generated UUID — server uses this for idempotency. */
  clientUuid: string;
  matchId: string;
  sequence: number;
  type: ExchangeType;
  occurredAt: string; // ISO 8601
  firstStrikerColor?: StrikerColor;
  firstStrikeValue?: number;
  afterblowValue?: number;
  noExchangeReason?: string;
  /** Match-clock position (active ms) at record time — display metadata carried
   *  through sync so an offline exchange keeps its timeline clock label. */
  clockTimeMs?: number | null;
  /** Timestamp when this entry was created locally (ms). */
  createdAt: number;
  /** Number of failed sync attempts. */
  attempts: number;
  /** Last error message from a failed sync attempt. */
  lastError?: string;
}

export interface SyncedEntry {
  /** Server-assigned UUID (same as clientUuid after successful sync). */
  clientUuid: string;
  matchId: string;
  sequence: number;
  /** Server-assigned row ID. */
  serverId: string;
  syncedAt: number; // ms
}

/**
 * An exchange the server REFUSED (HTTP 400), held rather than destroyed.
 *
 * This table is the whole reason the outbox no longer deletes on rejection: a
 * refused exchange is a hit a referee actually scored, and the only thing the
 * server's refusal proves is that this payload cannot be replayed as-is. Keeping
 * the row unblocks the in-order drain exactly as deleting it did, while leaving
 * the operator something to retry.
 */
export interface RejectedEntry extends Omit<OutboxEntry, 'id'> {
  /** Auto-incremented local PK, independent of the outbox id it came from. */
  id?: number;
  /** The server's own explanation — a 400 carries a real message (only 5xx is masked). */
  rejectedReason: string;
  rejectedAt: number; // ms
}

// ── Database ──────────────────────────────────────────────────────────────────

export class ScoringDb extends Dexie {
  outbox!: Table<OutboxEntry, number>;
  synced!: Table<SyncedEntry, string>;
  rejected!: Table<RejectedEntry, number>;

  constructor() {
    super('myclash-staff');

    this.version(1).stores({
      // id is auto-incremented PK; index matchId for per-match queries
      outbox: '++id, matchId, clientUuid, createdAt',
      // clientUuid is PK; index matchId + serverId
      synced: 'clientUuid, matchId, serverId',
    });

    // v2 adds `rejected`. `outbox` and `synced` are re-declared unchanged
    // because a Dexie version states the WHOLE schema, not a delta — omitting
    // them here would drop them, and a referee upgrading mid-event can have
    // queued exchanges sitting in v1. Existing rows migrate untouched.
    this.version(2).stores({
      outbox: '++id, matchId, clientUuid, createdAt',
      synced: 'clientUuid, matchId, serverId',
      rejected: '++id, matchId, clientUuid, rejectedAt',
    });
  }
}

/** Singleton — one DB instance per tab. */
export const db = new ScoringDb();
