/**
 * outbox.ts — IndexedDB outbox operations.
 *
 * AC:
 *   - Exchange creation writes to IndexedDB BEFORE any network call.
 *   - Outbox survives page reload (persisted in IndexedDB).
 *   - 1000 exchanges insert in <500ms locally.
 */

import { db, type OutboxEntry, type RejectedEntry } from './db';

// ── Write ─────────────────────────────────────────────────────────────────────

/**
 * Enqueue an exchange in the outbox.
 * Returns the auto-incremented local id.
 * Must be called BEFORE any network attempt.
 */
export async function enqueue(
  entry: Omit<OutboxEntry, 'id' | 'createdAt' | 'attempts' | 'lastError'>,
): Promise<number> {
  return db.outbox.add({
    ...entry,
    createdAt: Date.now(),
    attempts: 0,
  });
}

// ── Read ──────────────────────────────────────────────────────────────────────

/** All pending entries for a match, ordered by id (insertion order). */
export async function getPendingForMatch(matchId: string): Promise<OutboxEntry[]> {
  return db.outbox.where('matchId').equals(matchId).sortBy('id');
}

/** All pending entries across all matches, ordered by id. */
export async function getAllPending(): Promise<OutboxEntry[]> {
  return db.outbox.orderBy('id').toArray();
}

/** Count of pending entries for a match. */
export async function pendingCount(matchId: string): Promise<number> {
  return db.outbox.where('matchId').equals(matchId).count();
}

/** Total pending count across all matches. */
export async function totalPendingCount(): Promise<number> {
  return db.outbox.count();
}

// ── Update ────────────────────────────────────────────────────────────────────

/** Mark a sync attempt as failed — increment attempts, store error. */
export async function markFailed(id: number, error: string): Promise<void> {
  await db.outbox
    .where('id')
    .equals(id)
    .modify((entry) => {
      entry.attempts += 1;
      entry.lastError = error;
    });
}

// ── Delete ────────────────────────────────────────────────────────────────────

/**
 * Remove an entry from the outbox after successful sync.
 * Also writes to the `synced` table for reconciliation.
 */
export async function markSynced(
  id: number,
  clientUuid: string,
  matchId: string,
  sequence: number,
  serverId: string,
): Promise<void> {
  await db.transaction('rw', db.outbox, db.synced, async () => {
    await db.outbox.delete(id);
    await db.synced.put({
      clientUuid,
      matchId,
      sequence,
      serverId,
      syncedAt: Date.now(),
    });
  });
}

/** Remove all outbox entries for a match (e.g. match voided). */
export async function clearMatch(matchId: string): Promise<void> {
  await db.outbox.where('matchId').equals(matchId).delete();
}

/**
 * Drop the most recent QUEUED exchange for a match — the referee's undo, when
 * the hit has not reached the server yet.
 *
 * Pending means "not on the server", so this is a local delete rather than a
 * void: it never creates a `voided` row for a hit that never left the tablet,
 * which is also why it is the right answer online and not merely the offline
 * fallback.
 *
 * Returns the entry it removed, or null when the outbox holds nothing for this
 * match — in which case the last exchange IS on the server and the caller must
 * go and void it there.
 *
 * Reads and deletes in ONE transaction. A drain running concurrently deletes
 * the same row on success, and a read-then-delete would race it: we would
 * report an undo for a hit the server had just accepted. The caller also checks
 * `SyncEngine.isDraining()` first; this is the belt to that braces.
 */
export async function dequeueLastForMatch(matchId: string): Promise<OutboxEntry | null> {
  return db.transaction('rw', db.outbox, async () => {
    const pending = await db.outbox.where('matchId').equals(matchId).sortBy('id');
    const last = pending[pending.length - 1];
    if (!last?.id) return null;
    await db.outbox.delete(last.id);
    return last;
  });
}

/**
 * Move an entry the server REFUSED (HTTP 400) out of the outbox and into
 * `rejected`, keeping the payload and recording why.
 *
 * This replaces a hard delete. The delete existed to stop a permanently-failing
 * entry blocking an in-order queue — moving the row achieves that identically,
 * and stops a scored hit being destroyed on the way. Nothing is written to
 * `synced`: it never reached the server.
 *
 * A 400 is NOT proof that a retry can never succeed. A stale sequence, a locked
 * match and a round awaiting advance all clear on their own; only the payload
 * as-sent is known to be unacceptable. See `retryRejected` in sync.ts.
 */
export async function quarantine(id: number, reason: string): Promise<void> {
  await db.transaction('rw', db.outbox, db.rejected, async () => {
    const entry = await db.outbox.get(id);
    if (!entry) return;
    const { id: _outboxId, ...payload } = entry;
    await db.rejected.add({ ...payload, rejectedReason: reason, rejectedAt: Date.now() });
    await db.outbox.delete(id);
  });
}

/** Every quarantined entry, oldest first. */
export async function getRejected(): Promise<RejectedEntry[]> {
  return db.rejected.orderBy('id').toArray();
}

/** How many exchanges the server has refused and nobody has dealt with yet. */
export async function rejectedCount(): Promise<number> {
  return db.rejected.count();
}

/**
 * Put every quarantined entry back in the outbox to be tried again.
 *
 * Sequences are re-derived per match, because the most common reason a retry
 * would fail again is the sequence the entry was rejected with. `attempts` and
 * `lastError` reset — this is a fresh attempt, initiated by the operator.
 */
export async function requeueRejected(): Promise<number> {
  const entries = await getRejected();
  if (entries.length === 0) return 0;

  const nextByMatch = new Map<string, number>();
  for (const matchId of new Set(entries.map((e) => e.matchId))) {
    nextByMatch.set(matchId, await nextSequence(matchId));
  }

  await db.transaction('rw', db.outbox, db.rejected, async () => {
    for (const entry of entries) {
      const { id, rejectedReason: _reason, rejectedAt: _at, lastError: _err, ...payload } = entry;
      const sequence = nextByMatch.get(entry.matchId) ?? entry.sequence;
      nextByMatch.set(entry.matchId, sequence + 1);
      await db.outbox.add({ ...payload, sequence, attempts: 0 });
      if (id !== undefined) await db.rejected.delete(id);
    }
  });

  return entries.length;
}

/**
 * Put ONE quarantined entry back in the outbox.
 *
 * Same sequence re-derivation as {@link requeueRejected} — the sequence an
 * entry was rejected with is the single most likely reason it would be rejected
 * again, so a retry must never replay the old one.
 *
 * Returns false when the id is gone (another tab already dealt with it), so a
 * stale list in the inbox cannot silently double-queue a hit.
 */
export async function requeueRejectedEntry(id: number): Promise<boolean> {
  const entry = await db.rejected.get(id);
  if (!entry) return false;

  // Read the next sequence BEFORE opening the transaction: nextSequence reads
  // outbox + synced, and Dexie would have to join those tables into this
  // transaction's scope for a read inside it.
  const sequence = await nextSequence(entry.matchId);

  return db.transaction('rw', db.outbox, db.rejected, async () => {
    // Re-read inside the transaction — between the get above and here, another
    // tab may have requeued or discarded this row.
    const current = await db.rejected.get(id);
    if (!current) return false;
    const {
      id: _id,
      rejectedReason: _reason,
      rejectedAt: _at,
      lastError: _err,
      ...payload
    } = current;
    await db.outbox.add({ ...payload, sequence, attempts: 0 });
    await db.rejected.delete(id);
    return true;
  });
}

/**
 * Drop a quarantined entry for good.
 *
 * This DESTROYS a hit a referee scored, which is exactly what the rejected
 * table exists to prevent — so it is not a cleanup convenience. It is the exit
 * for the one case retrying cannot fix: the operator has already re-entered the
 * exchange by hand, and the held copy is now a duplicate keeping the sync bar
 * red. Callers must confirm before calling it.
 */
export async function discardRejected(id: number): Promise<void> {
  await db.rejected.delete(id);
}

// ── Sequence ──────────────────────────────────────────────────────────────────

/**
 * Next sequence number for a match.
 * = max(outbox sequences, synced sequences) + 1, or 1 if none.
 * Monotonically increasing even across reloads.
 */
export async function nextSequence(matchId: string): Promise<number> {
  const [outboxEntries, syncedEntries] = await Promise.all([
    db.outbox.where('matchId').equals(matchId).toArray(),
    db.synced.where('matchId').equals(matchId).toArray(),
  ]);

  const outboxMax = outboxEntries.reduce((m, e) => Math.max(m, e.sequence), 0);
  const syncedMax = syncedEntries.reduce((m, e) => Math.max(m, e.sequence), 0);

  return Math.max(outboxMax, syncedMax) + 1;
}

// ── Bulk insert (perf test helper) ────────────────────────────────────────────

/**
 * Bulk-insert N entries. Used by tests to verify <500ms for 1000 inserts.
 * Not used in production flow.
 */
export async function bulkEnqueue(
  entries: Array<Omit<OutboxEntry, 'id' | 'createdAt' | 'attempts' | 'lastError'>>,
): Promise<void> {
  const now = Date.now();
  await db.outbox.bulkAdd(entries.map((e) => ({ ...e, createdAt: now, attempts: 0 })));
}
