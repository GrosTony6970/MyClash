/**
 * reconcile.ts — T-504: Reconciliation on reconnect
 *
 * When server has exchanges the client doesn't know about
 * (admin edit, void from another device), merge server state
 * with local pending outbox.
 *
 * AC:
 *   - Local pending preserved; server state replayed; final state = union.
 *   - Voided exchanges on server reflected locally.
 */

import { db, type OutboxEntry, type SyncedEntry } from './db';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ServerExchange {
  id: string;
  clientUuid: string;
  matchId: string;
  sequence: number;
  type: string;
  occurredAt: string;
  voided: boolean;
  voidedReason?: string;
}

export interface ReconcileResult {
  /** Server exchanges not in local synced table → written to synced. */
  added: number;
  /** Server exchanges marked voided → removed from outbox if pending. */
  voided: number;
  /** Local pending entries preserved (not touched). */
  preserved: number;
}

// ── Reconcile ─────────────────────────────────────────────────────────────────

/**
 * Merge server exchange list with local IndexedDB state.
 *
 * Algorithm:
 *   1. Fetch all local synced + outbox clientUuids for the match.
 *   2. For each server exchange:
 *      a. If voided → remove from outbox (if present), skip synced write.
 *      b. If not in local synced → write to synced (server knows about it).
 *   3. Local outbox entries not on server → preserved (will drain later).
 */
export async function reconcile(
  matchId: string,
  serverExchanges: ServerExchange[],
): Promise<ReconcileResult> {
  const [outboxEntries, syncedEntries] = await Promise.all([
    db.outbox.where('matchId').equals(matchId).toArray(),
    db.synced.where('matchId').equals(matchId).toArray(),
  ]);

  const syncedUuids = new Set(syncedEntries.map((e) => e.clientUuid));
  const outboxUuids = new Set(outboxEntries.map((e) => e.clientUuid));
  const outboxByUuid = new Map<string, OutboxEntry>(outboxEntries.map((e) => [e.clientUuid, e]));

  let added = 0;
  let voided = 0;

  await db.transaction('rw', db.outbox, db.synced, async () => {
    for (const serverEx of serverExchanges) {
      if (serverEx.voided) {
        // Remove from outbox if it was pending locally
        const localEntry = outboxByUuid.get(serverEx.clientUuid);
        if (localEntry?.id !== undefined) {
          await db.outbox.delete(localEntry.id);
          voided++;
        }
        // Also remove from synced if present (voided = gone)
        if (syncedUuids.has(serverEx.clientUuid)) {
          await db.synced.delete(serverEx.clientUuid);
        }
      } else if (!syncedUuids.has(serverEx.clientUuid) && !outboxUuids.has(serverEx.clientUuid)) {
        // Server has it, we don't — write to synced
        const entry: SyncedEntry = {
          clientUuid: serverEx.clientUuid,
          matchId: serverEx.matchId,
          sequence: serverEx.sequence,
          serverId: serverEx.id,
          syncedAt: Date.now(),
        };
        await db.synced.put(entry);
        added++;
      }
    }
  });

  const preserved = await db.outbox.where('matchId').equals(matchId).count();

  return { added, voided, preserved };
}

/**
 * Fetch server exchanges for a match and reconcile with local state.
 * Convenience wrapper used by the sync engine on reconnect.
 */
export async function reconcileFromServer(
  matchId: string,
  apiUrl: string,
): Promise<ReconcileResult> {
  const res = await fetch(`${apiUrl}/api/v1/matches/${matchId}/exchanges`, {
    credentials: 'include',
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch server exchanges: HTTP ${res.status}`);
  }

  const serverExchanges = (await res.json()) as ServerExchange[];
  return reconcile(matchId, serverExchanges);
}
