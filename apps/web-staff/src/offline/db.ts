/**
 * db.ts — Dexie (IndexedDB) schema for the scoring app offline store.
 *
 * Tables:
 *   outbox   — pending exchanges waiting to be synced to the server
 *   synced   — exchanges confirmed by the server (kept for reconciliation)
 *   rejected — exchanges the server refused, held for the operator to retry
 */

import Dexie, { type Table } from 'dexie';
import type { PenaltyCard } from '@myclash/types';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ExchangeType = 'clean' | 'afterblow' | 'double' | 'no_exchange';
export type StrikerColor = 'red' | 'blue';
/**
 * Re-exported, not redeclared. This was the third independent copy of the same
 * three-member union (packages/ui and packages/rulesets held the others). The
 * pad now computes a card with the same function the server does, so it has to
 * be the same type. The local alias stays because outbox rows have used the
 * name since v3 and renaming a persisted field's type is not worth a migration.
 */
export type PenaltyCardColor = PenaltyCard;

/**
 * What kind of scored artefact an outbox row carries.
 *
 * Absent on rows written before v3, which were all exchanges — read it as
 * `?? 'exchange'` rather than assuming it is set. A referee upgrades mid-event
 * with a queue on disk.
 */
export type OutboxKind = 'exchange' | 'penalty';

export interface OutboxEntry {
  /** Auto-incremented local PK — determines drain order. */
  id?: number;
  /**
   * Which endpoint this row drains to. Undefined on v2 rows — see
   * {@link OutboxKind}.
   */
  kind?: OutboxKind;
  /** Client-generated UUID — server uses this for idempotency. */
  clientUuid: string;
  matchId: string;
  /**
   * Shared across BOTH kinds on purpose. `exchanges` and `match_penalties` each
   * carry their own UNIQUE(match_id, sequence), so one monotonic counter across
   * the two never collides — and it is what orders the unified timeline. Each
   * table simply ends up with gaps.
   */
  sequence: number;
  /** Exchange only. */
  type?: ExchangeType;
  occurredAt: string; // ISO 8601
  firstStrikerColor?: StrikerColor;
  firstStrikeValue?: number;
  afterblowValue?: number;
  noExchangeReason?: string;
  // ── Penalty only ───────────────────────────────────────────────────────────
  /** Which fighter the card is against. Required for a penalty. */
  registrationId?: string;
  /** Ruleset-driven penalty: the catalogue entry the referee picked. */
  rulesetEntryId?: string;
  /** Direct card, bypassing the catalogue. Needs a reason server-side. */
  directCard?: PenaltyCardColor;
  reason?: string;
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

/**
 * A GET response held on the tablet so the pad can seed from it before the
 * network answers — and instead of the network, when there is none.
 *
 * Setup data only: the tournament's scoring rules and its penalty catalogue.
 * NOT live match state. The service worker deliberately caches no /api/
 * response, and the reason is that serving a stale score is worse than serving
 * none. Serving a stale BUTTON is not: the alternative is the federal default,
 * which is silently wrong on a custom ruleset and says nothing about it.
 *
 * Keyed by request path, so the same table serves whatever else needs it later
 * without inventing a second cache.
 */
export interface CachedRead {
  /** Request path, e.g. `/api/v1/tournaments/:id/match-config`. */
  path: string;
  /** The parsed JSON body of the last successful response. */
  body: unknown;
  /** When it was fetched (ms) — what the pad shows as "last synced". */
  fetchedAt: number;
}

export class ScoringDb extends Dexie {
  outbox!: Table<OutboxEntry, number>;
  synced!: Table<SyncedEntry, string>;
  rejected!: Table<RejectedEntry, number>;
  reads!: Table<CachedRead, string>;

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

    // v3 lets the outbox carry penalties as well as exchanges. Same three
    // tables, same indexes — `kind` is not indexed because nothing queries by
    // it; the drain reads rows in id order and branches per row.
    //
    // All three re-declared for the reason v2's comment gives: a Dexie version
    // states the WHOLE schema, not a delta. No upgrade function: existing rows
    // are valid v3 rows with `kind` undefined, and every reader treats that as
    // 'exchange'. Backfilling would rewrite a referee's queue mid-event to
    // change nothing.
    this.version(3).stores({
      outbox: '++id, matchId, clientUuid, createdAt',
      synced: 'clientUuid, matchId, serverId',
      rejected: '++id, matchId, clientUuid, rejectedAt',
    });

    // v4 adds `reads`, the setup-data cache. All four re-declared for the
    // reason v2's comment gives: a Dexie version states the WHOLE schema, not a
    // delta. `path` is the primary key; nothing queries by anything else, so
    // there are no secondary indexes.
    //
    // No upgrade function. An empty `reads` is the correct starting state — the
    // pad simply behaves as it did before until the first successful fetch
    // fills it.
    this.version(4).stores({
      outbox: '++id, matchId, clientUuid, createdAt',
      synced: 'clientUuid, matchId, serverId',
      rejected: '++id, matchId, clientUuid, rejectedAt',
      reads: 'path',
    });
  }
}

/** Singleton — one DB instance per tab. */
export const db = new ScoringDb();
