/**
 * db.ts — Dexie (IndexedDB) schema for the scoring app offline store.
 *
 * Tables:
 *   outbox   — pending exchanges waiting to be synced to the server
 *   synced   — exchanges confirmed by the server (kept for reconciliation)
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

// ── Database ──────────────────────────────────────────────────────────────────

export class ScoringDb extends Dexie {
  outbox!: Table<OutboxEntry, number>;
  synced!: Table<SyncedEntry, string>;

  constructor() {
    super('myclash-scoring');

    this.version(1).stores({
      // id is auto-incremented PK; index matchId for per-match queries
      outbox: '++id, matchId, clientUuid, createdAt',
      // clientUuid is PK; index matchId + serverId
      synced: 'clientUuid, matchId, serverId',
    });
  }
}

/** Singleton — one DB instance per tab. */
export const db = new ScoringDb();
