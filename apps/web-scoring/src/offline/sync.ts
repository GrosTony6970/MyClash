/**
 * sync.ts — T-503: Background sync engine
 *
 * Drains the IndexedDB outbox to the server in insertion order.
 * Server idempotency on client_uuid means retries are safe.
 *
 * AC:
 *   - Reconnect → pending exchanges drain in order (by outbox id)
 *   - Server idempotency on client_uuid confirmed
 *   - UI shows pending count, syncing indicator, error state
 */

import {
  discardRejected,
  getAllPending,
  markFailed,
  markSynced,
  nextSequence,
  quarantine,
  rejectedCount,
  requeueRejected,
  requeueRejectedEntry,
  totalPendingCount,
} from './outbox';
import type { OutboxEntry } from './db';

// ── Types ─────────────────────────────────────────────────────────────────────

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error';

export interface SyncState {
  status: SyncStatus;
  pendingCount: number;
  /**
   * Exchanges the server REFUSED, held in `rejected` rather than destroyed.
   * Non-zero forces `status: 'error'` — a refused hit must never be reported to
   * a referee as a clean sync.
   */
  rejectedCount: number;
  /** Last error message, if status === 'error' */
  lastError?: string;
}

export type SyncStateListener = (state: SyncState) => void;

interface ExchangeResponse {
  id: string;
}

// ── SyncEngine ────────────────────────────────────────────────────────────────

export class SyncEngine {
  private apiUrl: string;
  private listeners: Set<SyncStateListener> = new Set();
  private running = false;
  private aborted = false;

  /** Max consecutive failures before engine stops and reports error. */
  private readonly maxConsecutiveFailures = 3;

  constructor(apiUrl: string) {
    this.apiUrl = apiUrl;
  }

  // ── Listeners ───────────────────────────────────────────────────────────────

  subscribe(listener: SyncStateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async emit(status: SyncStatus, lastError?: string): Promise<void> {
    const [pendingCount, rejected] = await Promise.all([totalPendingCount(), rejectedCount()]);
    // A held rejection outranks every other phase. Emitting 'idle' with refused
    // exchanges on disk is what made the bar go green over a hit that was
    // thrown away — the operator has to be told, and told until they act.
    const effectiveStatus = rejected > 0 && status !== 'offline' ? 'error' : status;
    const state: SyncState = {
      status: effectiveStatus,
      pendingCount,
      rejectedCount: rejected,
      lastError,
    };
    for (const listener of this.listeners) {
      listener(state);
    }
  }

  // ── Posting ─────────────────────────────────────────────────────────────────

  /**
   * POST one outbox entry, at the given sequence.
   *
   * The sequence is a parameter rather than read off the entry so the 400 path
   * can re-send the SAME hit under a corrected one. Every optional field is
   * sent as an explicit null — see the note on `CreateExchangeDto`; do not
   * "tidy" these into omissions.
   */
  private postExchange(entry: OutboxEntry, sequence: number): Promise<Response> {
    return fetch(`${this.apiUrl}/api/v1/matches/${entry.matchId}/exchanges`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        clientUuid: entry.clientUuid,
        sequence,
        type: entry.type,
        occurredAt: entry.occurredAt,
        firstStrikerColor: entry.firstStrikerColor ?? null,
        firstStrikeValue: entry.firstStrikeValue ?? null,
        afterblowValue: entry.afterblowValue ?? null,
        noExchangeReason: entry.noExchangeReason ?? null,
        clockTimeMs: entry.clockTimeMs ?? null,
      }),
    });
  }

  /**
   * Re-send a refused entry ONCE under a sequence derived from the server.
   *
   * Deliberately blind to WHY the server refused: matching on the message would
   * bind the client to wording it does not own. If the cause was a sequence
   * collision this succeeds; if it was anything else it fails the same way and
   * the caller quarantines. One attempt, never a loop.
   *
   * Returns the sequence actually used and the server's row id, or null.
   */
  private async retryWithFreshSequence(
    entry: OutboxEntry,
  ): Promise<{ sequence: number; serverId: string } | null> {
    const sequence = await this.freshSequence(entry.matchId);
    // Same sequence means nothing changed — a second identical POST would only
    // reproduce the same refusal.
    if (sequence === null || sequence === entry.sequence) return null;

    const res = await this.postExchange(entry, sequence);
    // 409 is the idempotency answer on client_uuid: it IS on the server.
    if (!res.ok && res.status !== 201 && res.status !== 409) return null;
    const data = (await res.json().catch(() => ({}))) as Partial<ExchangeResponse>;
    return { sequence, serverId: data.id ?? entry.clientUuid };
  }

  /** Highest sequence this match has anywhere — server or local — plus one. */
  private async freshSequence(matchId: string): Promise<number | null> {
    try {
      const res = await fetch(`${this.apiUrl}/api/v1/matches/${matchId}/exchanges`, {
        credentials: 'include',
      });
      if (!res.ok) return null;
      const rows = (await res.json()) as Array<{ sequence?: number | null }>;
      const serverMax = rows.reduce((max, row) => Math.max(max, row.sequence ?? 0), 0);
      return Math.max(serverMax + 1, await nextSequence(matchId));
    } catch {
      // Offline again — nothing to re-derive from. The caller quarantines.
      return null;
    }
  }

  // ── Drain ───────────────────────────────────────────────────────────────────

  /**
   * Drain all pending outbox entries to the server.
   * Processes in insertion order (by id).
   * Idempotent — safe to call multiple times.
   */
  async drain(): Promise<void> {
    if (this.running) return; // already draining
    this.running = true;
    this.aborted = false;

    const pending = await getAllPending();
    if (pending.length === 0) {
      await this.emit('idle');
      this.running = false;
      return;
    }

    await this.emit('syncing');

    let consecutiveFailures = 0;

    for (const entry of pending) {
      if (this.aborted) break;

      try {
        const res = await this.postExchange(entry, entry.sequence);

        if (res.ok || res.status === 201) {
          // Success or idempotent duplicate — remove from outbox
          const data = (await res.json()) as ExchangeResponse;
          await markSynced(entry.id!, entry.clientUuid, entry.matchId, entry.sequence, data.id);
          consecutiveFailures = 0;
          await this.emit('syncing');
        } else if (res.status === 409) {
          // Conflict = already exists on server (idempotency) — treat as success
          const data = (await res.json()) as ExchangeResponse;
          await markSynced(
            entry.id!,
            entry.clientUuid,
            entry.matchId,
            entry.sequence,
            data.id ?? entry.clientUuid,
          );
          consecutiveFailures = 0;
        } else if (res.status === 400) {
          // A refusal, NOT proof that a retry can never succeed. The single
          // most likely cause is a sequence this match has already used (two
          // pads, or a reload that seeded from a stale max), so re-derive the
          // sequence from the server and try exactly once more.
          const body = (await res.json().catch(() => ({}))) as { message?: string };
          const retried = await this.retryWithFreshSequence(entry);

          if (retried) {
            await markSynced(
              entry.id!,
              entry.clientUuid,
              entry.matchId,
              retried.sequence,
              retried.serverId,
            );
          } else {
            // Held, never destroyed: a refused exchange is a hit a referee
            // actually scored. Moving it out of the outbox keeps the in-order
            // queue draining — the whole point of the delete this replaces —
            // and `emit` now forces 'error' while any are held, so the bar
            // cannot go green over it.
            await quarantine(entry.id!, body.message ?? `HTTP ${res.status}`);
          }
          consecutiveFailures = 0;
          await this.emit('syncing');
        } else {
          // Server error — mark failed, continue to next
          const body = (await res.json().catch(() => ({}))) as {
            message?: string;
          };
          const error = body.message ?? `HTTP ${res.status}`;
          await markFailed(entry.id!, error);
          consecutiveFailures++;
        }
      } catch (err) {
        // Network error
        const error = err instanceof Error ? err.message : 'Network error';
        await markFailed(entry.id!, error);
        consecutiveFailures++;

        if (consecutiveFailures >= this.maxConsecutiveFailures) {
          await this.emit('offline');
          this.running = false;
          return;
        }
      }

      if (consecutiveFailures >= this.maxConsecutiveFailures) {
        await this.emit('error', 'Too many consecutive failures — check connection');
        this.running = false;
        return;
      }
    }

    const remaining = await totalPendingCount();
    if (remaining === 0) {
      await this.emit('idle');
    } else {
      await this.emit('error', 'Some exchanges could not be synced');
    }

    this.running = false;
  }

  /**
   * Put every refused exchange back in the queue and drain again — what the
   * operator's Retry button does.
   *
   * The conditions behind a 400 are mostly transient in the operator's own
   * hands: unlock the match, advance the round, let the other pad finish. So
   * the recovery is one deliberate action, not an automatic loop that would
   * hammer the server for as long as the condition holds. `requeueRejected`
   * re-derives sequences, so a stale one is fixed on the way through.
   */
  async retryRejected(): Promise<number> {
    const requeued = await requeueRejected();
    if (requeued > 0) await this.drain();
    else await this.emit('idle');
    return requeued;
  }

  /**
   * Retry ONE quarantined exchange, from the inbox.
   *
   * Goes through the engine rather than the store so the sync bar cannot go
   * stale: every path that changes what is held has to re-emit, and `emit`
   * re-derives `error` from the remaining count on its own.
   */
  async retryRejectedEntry(id: number): Promise<boolean> {
    const requeued = await requeueRejectedEntry(id);
    if (requeued) await this.drain();
    else await this.emit('idle');
    return requeued;
  }

  /**
   * Discard ONE quarantined exchange. Destroys a scored hit — the caller is
   * responsible for having confirmed it. See `discardRejected` in outbox.ts.
   */
  async discardRejectedEntry(id: number): Promise<void> {
    await discardRejected(id);
    await this.emit('idle');
  }

  /** Abort an in-progress drain (e.g. user navigates away). */
  abort(): void {
    this.aborted = true;
  }

  /** Current pending count without triggering a drain. */
  async getPendingCount(): Promise<number> {
    return totalPendingCount();
  }

  /** Exchanges the server refused and nobody has retried yet. */
  async getRejectedCount(): Promise<number> {
    return rejectedCount();
  }
}

// ── Singleton factory ─────────────────────────────────────────────────────────

let _engine: SyncEngine | null = null;

export function getSyncEngine(apiUrl: string): SyncEngine {
  if (!_engine) {
    _engine = new SyncEngine(apiUrl);
  }
  return _engine;
}
