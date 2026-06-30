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

import { dropTerminal, getAllPending, markFailed, markSynced, totalPendingCount } from './outbox';

// ── Types ─────────────────────────────────────────────────────────────────────

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error';

export interface SyncState {
  status: SyncStatus;
  pendingCount: number;
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
    const pendingCount = await totalPendingCount();
    const state: SyncState = { status, pendingCount, lastError };
    for (const listener of this.listeners) {
      listener(state);
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
        const res = await fetch(`${this.apiUrl}/api/v1/matches/${entry.matchId}/exchanges`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            clientUuid: entry.clientUuid,
            sequence: entry.sequence,
            type: entry.type,
            occurredAt: entry.occurredAt,
            firstStrikerColor: entry.firstStrikerColor ?? null,
            firstStrikeValue: entry.firstStrikeValue ?? null,
            afterblowValue: entry.afterblowValue ?? null,
            noExchangeReason: entry.noExchangeReason ?? null,
            clockTimeMs: entry.clockTimeMs ?? null,
          }),
        });

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
          // Terminal rejection — retrying can never succeed (best-of round
          // awaiting advance, stale sequence, invalid payload). Drop it so the
          // queue keeps draining instead of looping forever.
          const body = (await res.json().catch(() => ({}))) as { message?: string };
          console.warn(
            `Dropping rejected exchange ${entry.clientUuid}: ${body.message ?? 'HTTP 400'}`,
          );
          await dropTerminal(entry.id!);
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

  /** Abort an in-progress drain (e.g. user navigates away). */
  abort(): void {
    this.aborted = true;
  }

  /** Current pending count without triggering a drain. */
  async getPendingCount(): Promise<number> {
    return totalPendingCount();
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
