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
  claimForSend,
  discardRejected,
  getAllPending,
  getRejected,
  markFailed,
  markSynced,
  nextSequence,
  quarantine,
  rejectedCount,
  requeueRejected,
  requeueRejectedEntry,
  totalPendingCount,
} from './outbox';
import { fetchRenewingLogin } from '@myclash/api-client';
import { callerRefusalOf, hearCallerRefusals, type CallerRefusal } from './caller-refusal';
import { canSendAgain } from './can-send-again';
import type { OutboxEntry } from './db';
import { isDrillActive } from './drill';
import { classifySyncFailure, offlineResponse, type FailureBody } from './failure-kind';
import { takeBackNewest, type TakenBack } from './take-back';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * `signed-out`: the server answered a queued hit with 401. Nothing is refused
 * and nothing is lost; the queue waits until somebody signs in (ruling 241).
 * A `CallerRefusal`: the server refused it for who sends it, and the queue
 * waits the same way (rulings 244, 245). A press sent at once and refused
 * that way gives the same status with no hit queued (ruling 311).
 */
export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error' | 'signed-out' | CallerRefusal;

export interface SyncState {
  status: SyncStatus;
  pendingCount: number;
  /**
   * Exchanges the server REFUSED, held in `rejected` rather than destroyed.
   * Non-zero turns `idle` and `syncing` into `error` — a refused hit must never
   * be reported to a referee as a clean sync.
   */
  rejectedCount: number;
  /** The held ones a new send can cure: what Retry on the bar sends (ruling 291). */
  sendableCount: number;
  /** Last error message, if status === 'error' */
  lastError?: string;
}

export type SyncStateListener = (state: SyncState) => void;

interface ExchangeResponse {
  id: string;
}

/** The statuses `answerRefusal` reads: about the caller or the bout, never the sequence. */
const REFUSALS = [409, 403, 401];

/** How one entry's send ended, once its answer is filed. */
type Filed = 'sent' | 'held' | 'failed' | 'offline' | 'stopped';

/** An answer of that kind, met on the way to a second try. */
interface Refused {
  refused: Response;
}

/** Highest `sequence` in a list response, or 0 when it carries none. */
async function maxSequence(res: Response): Promise<number> {
  const rows = (await res.json().catch(() => [])) as Array<{ sequence?: number | null }>;
  if (!Array.isArray(rows)) return 0;
  return rows.reduce((max, row) => Math.max(max, row.sequence ?? 0), 0);
}

// ── SyncEngine ────────────────────────────────────────────────────────────────

export class SyncEngine {
  private apiUrl: string;
  private listeners: Set<SyncStateListener> = new Set();
  private running = false;
  /** The drain that runs, or the last one that ran. */
  private inFlight: Promise<void> = Promise.resolve();
  /** A send was asked for while one ran: the queue is walked once more. */
  private askedAgain = false;
  private sendEnded: Set<() => void> = new Set();
  /** The row whose POST is out (`claimForSend`), and the filing of its answer: what the undo asks. */
  private sendingId: number | null = null;
  private filed: Promise<unknown> = Promise.resolve();
  private aborted = false;
  /** What the engine last said: what an inbox action says again while a hit still waits. */
  private resting: SyncStatus = 'idle';
  /**
   * A press sent at once was refused for who sends it (ruling 311). It stands
   * in place of `idle` until a hit is taken or the caller changes: an action
   * that sends nothing proves nothing about the person.
   */
  private pressRefused: CallerRefusal | null = null;

  /** Max consecutive failures before engine stops and reports error. */
  private readonly maxConsecutiveFailures = 3;

  constructor(apiUrl: string) {
    this.apiUrl = apiUrl;
    hearCallerRefusals((caller) => {
      this.pressRefused = caller;
      void this.emit(caller);
    });
  }

  // ── Listeners ───────────────────────────────────────────────────────────────

  subscribe(listener: SyncStateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Told after each pass of a send that had something to send, whatever ended
   * it: the end of the list, an answer that stopped it, a throw. No press
   * waits for a send (ruling 316): the bout screen reads the server again
   * here. Per pass, not per send: presses that keep joining a send must not
   * keep the screen on what the server had before the first of them.
   */
  onSendEnded(ended: () => void): () => void {
    this.sendEnded.add(ended);
    return () => {
      this.sendEnded.delete(ended);
    };
  }

  private async emit(calm: SyncStatus, lastError?: string): Promise<void> {
    const status = calm === 'idle' ? (this.pressRefused ?? calm) : calm;
    this.resting = status;
    // One read of the held hits for both counts: two reads could disagree.
    const [pendingCount, held] = await Promise.all([totalPendingCount(), getRejected()]);
    const rejected = held.length;
    // A held rejection outranks a clean phase. Emitting 'idle' with refused
    // exchanges on disk is what made the bar go green over a hit that was
    // thrown away — the operator has to be told, and told until they act.
    // Not over `signed-out` or a refused caller: "refused" would hide why nothing goes.
    const outranked = status === 'idle' || status === 'syncing';
    const effectiveStatus = rejected > 0 && outranked ? 'error' : status;
    const state: SyncState = {
      status: effectiveStatus,
      pendingCount,
      rejectedCount: rejected,
      sendableCount: held.filter(canSendAgain).length,
      lastError,
    };
    for (const listener of this.listeners) {
      listener(state);
    }
  }

  /**
   * The state after an inbox action that sent nothing. `idle` there turned the
   * bar green over hits a signed-out or failing pad still holds: while one
   * waits, what the engine last said stands. With none left (an undo removes
   * a waiting hit and emits nothing), `idle` is true again, or the refusal of
   * a press that still stands (`pressRefused`).
   */
  private async emitResting(): Promise<void> {
    await this.emit((await totalPendingCount()) > 0 ? this.resting : 'idle');
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
    // The offline drill intercepts here, and ONLY here.
    //
    // It answers with the exact response the service worker produces during a
    // real outage, so everything downstream — the classification, the outbox,
    // the retry accounting, the bar — is the real code path rather than a
    // parallel one that might drift from it. A drill that took a shortcut past
    // any of that would be teaching the crew a screen they will never see.
    if (isDrillActive()) return Promise.resolve(offlineResponse());

    // A penalty is a scored artefact like an exchange: same client_uuid
    // idempotency (match_penalties.client_uuid is NOT NULL UNIQUE, migration
    // 0016), same server-side dedupe, same client-supplied occurred_at — so a
    // card drained twenty minutes later still records the moment it was issued.
    // Only the URL and the body differ; everything below this method is
    // kind-agnostic already.
    if ((entry.kind ?? 'exchange') === 'penalty') {
      return fetchRenewingLogin(this.apiUrl, `/api/v1/matches/${entry.matchId}/penalties`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          clientUuid: entry.clientUuid,
          sequence,
          registrationId: entry.registrationId,
          occurredAt: entry.occurredAt,
          clockTimeMs: entry.clockTimeMs ?? null,
          ...(entry.rulesetEntryId ? { rulesetEntryId: entry.rulesetEntryId } : {}),
          ...(entry.directCard ? { directCard: entry.directCard } : {}),
          ...(entry.reason ? { reason: entry.reason } : {}),
        }),
      });
    }

    return fetchRenewingLogin(this.apiUrl, `/api/v1/matches/${entry.matchId}/exchanges`, {
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
   * Returns the sequence actually used and the server's row id, or null. An
   * answer `answerRefusal` reads (the session ended, the person may not score,
   * the Event is over) is handed back as it came: it is about the caller or
   * the bout, not about the sequence.
   */
  private async retryWithFreshSequence(
    entry: OutboxEntry,
  ): Promise<{ sequence: number; serverId: string } | Refused | null> {
    const sequence = await this.freshSequence(entry.matchId);
    // Same sequence means nothing changed — a second identical POST would only
    // reproduce the same refusal.
    if (sequence === null || sequence === entry.sequence) return null;

    const res = await this.postExchange(entry, sequence);
    if (REFUSALS.includes(res.status)) return { refused: res };
    // Only a 2xx is on the server.
    if (!res.ok) return null;
    const data = (await res.json().catch(() => ({}))) as Partial<ExchangeResponse>;
    return { sequence, serverId: data.id ?? entry.clientUuid };
  }

  /**
   * Highest sequence this match has anywhere — server or local — plus one.
   *
   * BOTH server tables, not just exchanges. The counter is shared across
   * exchanges and penalties (see `OutboxEntry.sequence`), so re-deriving from
   * one of them can hand a retry a number the other already holds — and a
   * sequence collision is the single most likely reason the entry was refused
   * in the first place. Reading one table would fix the collision it was
   * refused for and walk straight into its twin.
   */
  private async freshSequence(matchId: string): Promise<number | null> {
    try {
      const [exchanges, penalties] = await Promise.all([
        fetch(`${this.apiUrl}/api/v1/matches/${matchId}/exchanges`, { credentials: 'include' }),
        fetch(`${this.apiUrl}/api/v1/matches/${matchId}/penalties`, { credentials: 'include' }),
      ]);
      // Exchanges must answer — it is the older endpoint and the one every
      // match has. A penalties read that fails degrades to "no cards", which is
      // still better than giving up on the retry entirely.
      if (!exchanges.ok) return null;
      const serverMax = Math.max(
        await maxSequence(exchanges),
        penalties.ok ? await maxSequence(penalties) : 0,
      );
      return Math.max(serverMax + 1, await nextSequence(matchId));
    } catch {
      // Offline again — nothing to re-derive from. The caller quarantines.
      return null;
    }
  }

  /**
   * A 409 and a 403 are refusals, NEVER "already on the server": the API answers
   * a repeated client_uuid with the saved row and a 2xx. A 409 here is an Event
   * that is over. A 403 the API words is "may not score this" (ruling 242: a
   * pad moved off its piste, a pad of another Event). Held with its code, and not
   * re-sent: no other sequence makes the server take it. `failed` for a 403 with
   * no code: the edge wrote it (a blocked network), about no hit, so it waits.
   * `stopped` for an answer about the CALLER: a 401, and a 403 whose code is a
   * `CallerRefusal` (rulings 244, 245).
   */
  private async answerRefusal(
    entry: OutboxEntry,
    res: Response,
  ): Promise<'held' | 'failed' | 'stopped'> {
    if (res.status === 401) return this.waitForCaller('signed-out');
    const body = (await res.json().catch(() => ({}))) as FailureBody & { code?: string };
    const caller = res.status === 403 ? callerRefusalOf(body.code) : undefined;
    if (caller) return this.waitForCaller(caller);
    if (res.status === 403 && !body.code) {
      await markFailed(entry.id!, `HTTP ${res.status}`);
      return 'failed';
    }
    await quarantine(entry.id!, body.message ?? `HTTP ${res.status}`, body.code);
    return 'held';
  }

  /**
   * An answer about the caller: nobody is signed in (a 401, ruling 241), or the
   * person may not score at all. The hit is not refused and its attempt is not
   * counted as failed: it waits, in order. The drain ends here: every hit
   * behind it meets the same answer. An account's login was asked to renew
   * before a 401 (`postExchange` sends through `fetchRenewingLogin`); a PIN
   * session cannot be renewed.
   */
  private async waitForCaller(status: 'signed-out' | CallerRefusal): Promise<'stopped'> {
    await this.emit(status);
    return 'stopped';
  }

  /**
   * A 400 is a refusal, NOT proof that a retry can never succeed. The single
   * most likely cause is a sequence this match has already used (two pads, or
   * a reload that seeded from a stale max), so re-derive the sequence from the
   * server and try exactly once more. A second answer about the caller (a
   * 401, a 403) makes the hit wait, and a 409 is held with its own code, as a
   * first answer would. Any other second answer holds it under the first.
   */
  private async answerBadRequest(
    entry: OutboxEntry,
    res: Response,
  ): Promise<'sent' | 'held' | 'failed' | 'stopped'> {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    const retried = await this.retryWithFreshSequence(entry);
    if (retried && 'refused' in retried) return this.answerRefusal(entry, retried.refused);
    if (retried) {
      await markSynced(
        entry.id!,
        entry.clientUuid,
        entry.matchId,
        retried.sequence,
        retried.serverId,
      );
      this.pressRefused = null;
      return 'sent';
    }
    // Held, never destroyed: a refused exchange is a hit a referee actually
    // scored. Moving it out of the outbox keeps the in-order queue draining,
    // and `emit` forces 'error' while any are held, so the bar cannot go green
    // over it.
    await quarantine(entry.id!, body.message ?? `HTTP ${res.status}`);
    return 'held';
  }

  // ── Drain ───────────────────────────────────────────────────────────────────

  /**
   * Drain all pending outbox entries to the server.
   * Processes in insertion order (by id).
   *
   * The race is a hit or a card queued while a send runs: that send walks the
   * list it read at its start. So a drain asked for meanwhile means one more
   * pass, and its caller waits for that pass: the inbox reads its list again
   * once a Retry's hit is answered. A press never waits: `sendBehind`.
   */
  drain(): Promise<void> {
    if (this.running) {
      this.askedAgain = true;
      // The queue grew under a send that runs: the count is said now, so the
      // hit shows as provisional before the answer in flight. The race is the
      // send's last word (it stopped: signed out, no network): said after it,
      // `syncing` would hide why nothing goes. So this says again what the
      // engine last said, and chooses no status.
      this.emit(this.resting).catch((err: unknown) => {
        console.error('[sync] the count of a joined press could not be said', err);
      });
      return this.inFlight;
    }
    this.inFlight = this.sendQueue();
    return this.inFlight;
  }

  /**
   * What a press asks for once its hit or card is on the tablet (ruling 316):
   * a send nobody waits for. The buttons come back at once, and `onSendEnded`
   * says when the screen should read the server again. A send that throws
   * has no caller to tell, so it is logged; the hit is kept and goes with the
   * next send.
   */
  sendBehind(): void {
    this.drain().catch((err: unknown) => {
      console.error('[sync] a send nobody waited for threw', err);
    });
  }

  /**
   * Send the queue for the caller as it is NOW: a sign-out just changed it.
   * The race is a send in flight (a Retry, a hit just scored). It left as the
   * old caller, so its answer says nothing of the new one: wait it out, then
   * send again.
   */
  async drainAsNewCaller(): Promise<void> {
    await this.inFlight;
    this.pressRefused = null;
    await this.drain();
  }

  /**
   * One pass of the queue, and one more for each drain asked for meanwhile. A
   * pass that stopped is not followed by another: what stopped it (the caller,
   * three failures in a row) meets the hit behind it too, and that hit waits.
   */
  private async sendQueue(): Promise<void> {
    this.running = true;
    this.aborted = false;
    try {
      do {
        this.askedAgain = false;
        const pass = await this.sendPass();
        if (pass !== 'empty') this.tellSendEnded();
        if (pass === 'stopped') return;
        // Not between two passes: "could not be synced" over a hit about to go.
        if (!this.askedAgain) await this.emitWalked();
      } while (this.askedAgain);
    } catch (err) {
      // Hits may have gone before the throw: the screen is told all the same.
      this.tellSendEnded();
      throw err;
    } finally {
      this.running = false;
    }
  }

  /** One listener that throws must not turn a send that went well into a failed one. */
  private tellSendEnded(): void {
    for (const ended of this.sendEnded) {
      try {
        ended();
      } catch (err) {
        console.error('[sync] a listener of the end of a send threw', err);
      }
    }
  }

  /** Walks the queue as it is now. `stopped`: an answer ended the send, and the bar says which. */
  private async sendPass(): Promise<'empty' | 'walked' | 'stopped'> {
    const pending = await getAllPending();
    if (pending.length === 0) return 'empty';

    await this.emit('syncing');

    let consecutiveFailures = 0;

    for (const entry of pending) {
      if (this.aborted) break;

      const outcome = await this.sendClaimed(entry);
      // The undo removed it since this pass listed it: nothing was sent.
      if (outcome === 'gone') continue;
      if (outcome === 'stopped') return 'stopped';
      const failed = outcome === 'failed' || outcome === 'offline';
      consecutiveFailures = failed ? consecutiveFailures + 1 : 0;

      if (consecutiveFailures >= this.maxConsecutiveFailures) {
        if (outcome === 'offline') await this.emit('offline');
        else await this.emit('error', 'Too many consecutive failures — check connection');
        return 'stopped';
      }
    }
    return 'walked';
  }

  /** The end of a send that walked the whole queue: green, or what still waits. */
  private async emitWalked(): Promise<void> {
    if ((await totalPendingCount()) === 0) await this.emit('idle');
    else await this.emit('error', 'Some exchanges could not be synced');
  }

  /**
   * Claim one row, send it, file its answer, let it go. The race is the undo
   * (`takeBackNewest`): it may delete a row this pass has listed and not yet
   * sent, never the one that is out. `filed` is set before the claim is asked,
   * so an undo that meets the claim always has this answer to wait for.
   */
  private sendClaimed(entry: OutboxEntry): Promise<Filed | 'gone'> {
    const send = async (): Promise<Filed | 'gone'> => {
      const claimed = await claimForSend(entry.id!, (id) => {
        this.sendingId = id;
      });
      return claimed ? this.sendEntry(entry) : 'gone';
    };
    const filed = send().finally(() => {
      this.sendingId = null;
    });
    this.filed = filed;
    return filed;
  }

  /**
   * The pad's undo of what waits on the tablet for a bout (rulings 317, 318).
   * A removal changes the count, so the state is said again.
   */
  async takeBackNewest(matchId: string): Promise<TakenBack> {
    const taken = await takeBackNewest(matchId, {
      isOnItsWay: (id) => this.sendingId === id,
      whenFiled: () => this.filed,
    });
    if (taken.kind === 'removed') await this.emitResting();
    return taken;
  }

  /**
   * Send one entry and file its answer. `offline` is a failure that reads as a
   * dead network; `failed` is any other the entry waits behind.
   */
  private async sendEntry(entry: OutboxEntry): Promise<Filed> {
    try {
      const res = await this.postExchange(entry, entry.sequence);

      if (res.ok || res.status === 201) {
        // Success or idempotent duplicate — remove from outbox
        const data = (await res.json()) as ExchangeResponse;
        await markSynced(entry.id!, entry.clientUuid, entry.matchId, entry.sequence, data.id);
        this.pressRefused = null;
        await this.emit('syncing');
        return 'sent';
      }
      if (res.status === 400 || REFUSALS.includes(res.status)) {
        const outcome =
          res.status === 400
            ? await this.answerBadRequest(entry, res)
            : await this.answerRefusal(entry, res);
        if (outcome !== 'stopped') await this.emit('syncing');
        return outcome;
      }
      const body = (await res.json().catch(() => null)) as FailureBody | null;
      const kind = classifySyncFailure(res.status, body);
      await markFailed(entry.id!, body?.message ?? kind);
      // A resolved 503 is what a real outage looks like here: the service
      // worker turns a dead network into one rather than letting fetch
      // reject, which is why the catch below could never report offline.
      // See failure-kind.ts.
      return kind === 'offline' ? 'offline' : 'failed';
    } catch (err) {
      // A genuine rejection. Only reachable when the service worker is not
      // in play at all — a first load before it installs, or a dev server.
      const error = err instanceof Error ? err.message : 'Network error';
      await markFailed(entry.id!, error);
      return 'offline';
    }
  }

  /**
   * Put every refused exchange a new send can cure back in the queue and drain
   * again — what the operator's Retry button does.
   *
   * The conditions behind a 400 are mostly transient in the operator's own
   * hands: unlock the match, advance the round, let the other pad finish. So
   * the recovery is one deliberate action, not an automatic loop that would
   * hammer the server for as long as the condition holds. `requeueRejected`
   * re-derives sequences, so a stale one is fixed on the way through. A hit
   * no new send can cure is not sent: it stays held (ruling 291).
   */
  async retryRejected(): Promise<number> {
    const requeued = await requeueRejected();
    if (requeued > 0) await this.drain();
    else await this.emitResting();
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
    else await this.emitResting();
    return requeued;
  }

  /**
   * Discard ONE quarantined exchange. Destroys a scored hit — the caller is
   * responsible for having confirmed it. See `discardRejected` in outbox.ts.
   */
  async discardRejectedEntry(id: number): Promise<void> {
    await discardRejected(id);
    await this.emitResting();
  }

  /**
   * Say the state again from what the tablet holds now. The inbox asks when it
   * opens: another tab may have dealt with a held hit, and a bar that offers
   * Review alone (ruling 291) has no other button that would find out.
   */
  async refreshState(): Promise<void> {
    await this.emitResting();
  }

  /** Abort an in-progress drain (e.g. user navigates away). */
  abort(): void {
    this.aborted = true;
  }

  /** Is a send running right now? The undo no longer asks (`takeBackNewest`): tests do. */
  isDraining(): boolean {
    return this.running;
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
