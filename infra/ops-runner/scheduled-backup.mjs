import { randomUUID } from 'node:crypto';
import { nextBackupRun, shouldRunScheduledBackup } from './backup-core.mjs';

/**
 * The nightly backup's scheduler (ruling 217). A slot that meets the ops lock held (a restore, a
 * delete-all, an upload) stays PENDING and is tried on every tick until it starts; when the next
 * slot of the schedule in force arrives first, the night is recorded as a failed backup.
 *
 * `start()` resolves `'running'` once the lock is TAKEN (not when the backup ends), `'busy'`, or
 * `'failed'` (the lock could not be written: a run that failed, recorded with its own cause).
 * One attempt at a time: a tick that lands during an attempt does nothing.
 * The pending slot lives in memory only: a redeploy while a night waits forgets it.
 */
export function createScheduledBackup({ start, recordMissed }) {
  let lastRunKey = null;
  let pending = null;
  let inFlight = false;

  return {
    async tick(schedule, now = new Date()) {
      if (inFlight) return 'in-flight';
      if (pending && slotIsOver(schedule, pending, now)) {
        const missed = pending;
        pending = null;
        await recordMissed(missed, now);
      }
      const decision = shouldRunScheduledBackup(schedule, now, lastRunKey);
      if (decision.shouldRun && decision.runKey) {
        lastRunKey = decision.runKey;
        pending = { runKey: decision.runKey, slotAt: startOfMinute(now) };
      }
      if (!pending) return 'idle';
      inFlight = true;
      try {
        const result = await start();
        // 'failed' ran and failed for its own cause (its history line says it): no retry.
        if (result !== 'busy') pending = null;
        return result;
      } finally {
        inFlight = false;
      }
    },
  };
}

/** Read from the CURRENT schedule: a change while a night waits moves its end. Off = over. */
function slotIsOver(schedule, slot, now) {
  const next = nextBackupRun(schedule, slot.slotAt);
  return next === null || now.getTime() >= Date.parse(next);
}

function startOfMinute(date) {
  const copy = new Date(date);
  copy.setUTCSeconds(0, 0);
  return copy;
}

/** A night that never started, as a backup history entry: the screen's "last backup" shows it. */
export function missedBackupRecord(slot, now) {
  return {
    id: randomUUID(),
    kind: 'backup',
    status: 'failed',
    startedAt: slot.slotAt.toISOString(),
    finishedAt: now.toISOString(),
    scheduled: true,
    // The screen words the code (en + fr); the sentence is for the log and an old screen.
    code: MISSED_BACKUP_CODE,
    error:
      'The scheduled backup did not run: another operation was running until its time was over.',
  };
}

export const MISSED_BACKUP_CODE = 'scheduled_backup_missed';
