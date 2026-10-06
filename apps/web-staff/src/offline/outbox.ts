/**
 * outbox.ts — IndexedDB outbox operations.
 *
 * AC:
 *   - Exchange creation writes to IndexedDB BEFORE any network call.
 *   - Outbox survives page reload (persisted in IndexedDB).
 *   - 1000 exchanges insert in <500ms locally.
 */

import { canSendAgain } from './can-send-again';
import { db, type OutboxEntry, type RejectedEntry } from './db';
import { newestOf } from './newest-entry';

// ── Write ─────────────────────────────────────────────────────────────────────

/**
 * Enqueue an exchange in the outbox.
 * Returns the auto-incremented local id.
 * Must be called BEFORE any network attempt.
 *
 * `entry.sequence` is the bout screen's counter, which moves on only once the
 * screen has drawn again after a press. The race is two presses the counter
 * has not caught up with (a card right behind a hit): both carry the same
 * number. The store holds what was queued, so the later one gets the next
 * number here, read and written in ONE transaction.
 */
export async function enqueue(
  entry: Omit<OutboxEntry, 'id' | 'createdAt' | 'attempts' | 'lastError'>,
): Promise<number> {
  return db.transaction('rw', db.outbox, db.synced, async () =>
    db.outbox.add({
      ...entry,
      sequence: Math.max(entry.sequence, await nextSequence(entry.matchId)),
      createdAt: Date.now(),
      attempts: 0,
    }),
  );
}

/** A card's row in the queue: what every card carries, around what this one is. */
export function queueCard(
  card: Omit<Parameters<typeof enqueue>[0], 'kind' | 'clientUuid' | 'occurredAt'>,
): Promise<number> {
  return enqueue({
    kind: 'penalty',
    clientUuid: crypto.randomUUID(),
    occurredAt: new Date().toISOString(),
    ...card,
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

/** What the undo found on the tablet for a bout. Null: nothing waits there. */
export type Dequeued = { removed: OutboxEntry } | { onItsWay: OutboxEntry } | null;

/**
 * Drop the newest QUEUED hit or card of a match: the referee's undo, when the
 * entry has not reached the server yet (rulings 317, 318).
 *
 * Pending means "not on the server", so this is a local delete rather than a
 * void: it never creates a `voided` row for an entry that never left the
 * tablet, which is also why it is the right answer online and not merely the
 * offline fallback.
 *
 * Newest is the last line of the bout's list (`newestOf`), not the last row
 * added: a held hit sent again is added last and was scored first.
 *
 * The race is the send: the row may be the one whose POST is out, and a row
 * deleted here would then be on the server with the referee believing it
 * gone. So the row the send has claimed is NOT deleted: it is handed back as
 * `onItsWay`, and the caller waits for its answer. The claim is asked inside
 * this write transaction, and `claimForSend` notes it inside another: the
 * store runs the two one after the other, so either this sees the claim or
 * the send sees the delete.
 */
export async function dequeueNewestForMatch(
  matchId: string,
  isOnItsWay: (id: number) => boolean = () => false,
): Promise<Dequeued> {
  return db.transaction('rw', db.outbox, async () => {
    const pending = await db.outbox.where('matchId').equals(matchId).toArray();
    const newest = newestOf(pending, (entry) => entry);
    if (!newest?.id) return null;
    if (isOnItsWay(newest.id)) return { onItsWay: newest };
    await db.outbox.delete(newest.id);
    return { removed: newest };
  });
}

/**
 * The send's claim of one row, just before its POST: the row is read again and
 * the claim noted in ONE write transaction. False when the undo removed the
 * row since the send listed it: it must not go.
 */
export async function claimForSend(id: number, note: (id: number) => void): Promise<boolean> {
  return db.transaction('rw', db.outbox, async () => {
    if (!(await db.outbox.get(id))) return false;
    note(id);
    return true;
  });
}

/**
 * Remove an entry the undo waited for, once its send was answered and the
 * tablet does not know it as taken: it still waits (the answer was a failure)
 * or it is held (the server refused it). `on-its-way` when a new send claimed
 * it meanwhile. Found by its uuid, not its row id: a Retry puts a held entry
 * back in the queue under a new one.
 *
 * A failure is not proof the server took nothing: an answer can be lost on the
 * way back. Such a hit shows again at the next read of the bout, where the
 * undo takes it back on the server. The same holds for any waiting entry.
 */
export async function removeUnsent(
  entry: OutboxEntry,
  isOnItsWay: (id: number) => boolean,
): Promise<'removed' | 'on-its-way'> {
  return db.transaction('rw', db.outbox, db.rejected, async () => {
    const waiting = await db.outbox.where('clientUuid').equals(entry.clientUuid).first();
    if (waiting?.id !== undefined) {
      if (isOnItsWay(waiting.id)) return 'on-its-way';
      await db.outbox.delete(waiting.id);
      return 'removed';
    }
    await db.rejected.where('clientUuid').equals(entry.clientUuid).delete();
    return 'removed';
  });
}

/**
 * Move an entry the server REFUSED (a 400, a 409, a 403) out of the outbox and into
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
export async function quarantine(id: number, reason: string, code?: string): Promise<void> {
  await db.transaction('rw', db.outbox, db.rejected, async () => {
    const entry = await db.outbox.get(id);
    if (!entry) return;
    const { id: _outboxId, ...payload } = entry;
    await db.rejected.add({
      ...payload,
      rejectedReason: reason,
      ...(code ? { rejectedCode: code } : {}),
      rejectedAt: Date.now(),
    });
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
 * Put every quarantined entry a new send can cure back in the outbox to be
 * tried again. One that can never pass stays held (ruling 291).
 *
 * Sequences are re-derived per match, because the most common reason a retry
 * would fail again is the sequence the entry was rejected with. `attempts` and
 * `lastError` reset — this is a fresh attempt, initiated by the operator.
 *
 * In the order the hits were SCORED, not the order they were held: a Retry of
 * one hit that is refused again holds it last, and a bout's hits would go to
 * the server in another order. `createdAt` rides through every move.
 */
export async function requeueRejected(): Promise<number> {
  const curable = (await getRejected()).filter(canSendAgain);
  const entries = curable.sort((a, b) => a.createdAt - b.createdAt);
  if (entries.length === 0) return 0;

  const nextByMatch = new Map<string, number>();
  for (const matchId of new Set(entries.map((e) => e.matchId))) {
    nextByMatch.set(matchId, await nextSequence(matchId));
  }

  await db.transaction('rw', db.outbox, db.rejected, async () => {
    for (const entry of entries) {
      const {
        id,
        rejectedReason: _reason,
        rejectedCode: _code,
        rejectedAt: _at,
        lastError: _err,
        ...payload
      } = entry;
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
      rejectedCode: _code,
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
 *
 * Spans BOTH kinds, because the outbox holds both and the counter is shared:
 * `exchanges` and `match_penalties` each have their own
 * UNIQUE(match_id, sequence), so one series across the two never collides and
 * is what orders the unified timeline. Since penalties joined the queue this
 * also fixes the reload seed — a queued card used to be invisible to it.
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
