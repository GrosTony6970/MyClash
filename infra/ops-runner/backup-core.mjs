import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const BACKUP_TIMESTAMP_PATTERN = /^\d{8}T\d{6}Z$/;
export const BACKUP_FILENAME_PATTERN =
  /^(db-(?<dbTs>\d{8}T\d{6}Z)\.sql\.gz|storage-(?<storageTs>\d{8}T\d{6}Z)\.tar\.gz)(?<gpg>\.gpg)?$/;

export const BACKUP_FREQUENCIES = Object.freeze([
  'hourly',
  'every6h',
  'every12h',
  'daily',
  'weekly',
  'monthly',
]);

export const DEFAULT_BACKUP_SCHEDULE = Object.freeze({
  enabled: true,
  frequency: 'daily',
  hourUtc: 3,
  minuteUtc: 0,
  // Sunday=0 ... Saturday=6. Defaults to Monday so weekly backups
  // land on a workday when humans can react to a failure.
  dayOfWeek: 1,
  // Capped at 28 so the schedule fires every month — picking 30 or 31
  // would skip Feb. The admin UI enforces the cap on the input.
  dayOfMonth: 1,
  // Local retention (small, fast restores from the VPS disk) is kept
  // shorter than cloud (long-term DR copy on cheap object storage).
  retentionCountLocal: 14,
  retentionCountCloud: 60,
  timezoneLabel: 'UTC',
  updatedAt: null,
});

export function parseBackupFilename(filename) {
  const base = path.basename(filename);
  if (filename !== base) return null;
  const match = BACKUP_FILENAME_PATTERN.exec(base);
  if (!match?.groups) return null;
  const timestamp = match.groups.dbTs ?? match.groups.storageTs;
  return {
    kind: match.groups.dbTs ? 'db' : 'storage',
    timestamp,
    filename: base,
    encrypted: Boolean(match.groups.gpg),
  };
}

export function parseAwsS3List(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match =
        /^(?<date>\d{4}-\d{2}-\d{2})\s+(?<time>\d{2}:\d{2}:\d{2})\s+(?<size>\d+)\s+(?<key>.+)$/.exec(
          line,
        );
      if (!match?.groups) return null;
      return {
        key: path.basename(match.groups.key),
        sizeBytes: Number(match.groups.size),
        modifiedAt: `${match.groups.date}T${match.groups.time}Z`,
      };
    })
    .filter(Boolean);
}

export function expectedBackupArtifactFilenames(timestamp) {
  return [
    `db-${timestamp}.sql.gz`,
    `db-${timestamp}.sql.gz.gpg`,
    `storage-${timestamp}.tar.gz`,
    `storage-${timestamp}.tar.gz.gpg`,
  ];
}

export async function listLocalBackupArtifacts(rootDir) {
  const nightlyDir = path.join(rootDir, 'backups', 'nightly');
  let entries = [];
  try {
    entries = await readdir(nightlyDir);
  } catch {
    return [];
  }

  const artifacts = [];
  for (const entry of entries) {
    const parsed = parseBackupFilename(entry);
    if (!parsed) continue;
    const fileStat = await stat(path.join(nightlyDir, entry));
    artifacts.push({
      ...parsed,
      sizeBytes: fileStat.size,
      modifiedAt: fileStat.mtime.toISOString(),
    });
  }
  return artifacts;
}

export function backupSetsFromArtifacts({
  localArtifacts = [],
  cloudArtifacts = [],
  uploadArtifacts = [],
}) {
  const map = new Map();
  addArtifacts(map, 'local', localArtifacts);
  addArtifacts(map, 'cloud', cloudArtifacts);
  addArtifacts(map, 'upload', uploadArtifacts);
  return [...map.values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export function buildBackupSet(id, timestamp, artifacts, location) {
  return {
    id,
    timestamp,
    displayName: id,
    local: {
      available: location === 'local' && artifacts.length > 0,
      artifacts: location === 'local' ? artifacts.map(toDtoArtifact) : [],
    },
    cloud: {
      available: location === 'cloud' && artifacts.length > 0,
      artifacts: location === 'cloud' ? artifacts.map(toDtoArtifact) : [],
    },
    ...(location === 'upload'
      ? { upload: { available: artifacts.length > 0, artifacts: artifacts.map(toDtoArtifact) } }
      : {}),
  };
}

export async function readBackupSchedule(rootDir) {
  try {
    const text = await readFile(backupSchedulePath(rootDir), 'utf8');
    const parsed = JSON.parse(text);
    return normalizeBackupSchedule(parsed);
  } catch {
    return { ...DEFAULT_BACKUP_SCHEDULE };
  }
}

export async function writeBackupSchedule(rootDir, input) {
  const schedule = normalizeBackupSchedule({
    ...input,
    updatedAt: new Date().toISOString(),
  });
  const filePath = backupSchedulePath(rootDir);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(schedule, null, 2)}\n`, 'utf8');
  return schedule;
}

export function normalizeBackupSchedule(input = {}) {
  const hourUtc = Number(input.hourUtc ?? DEFAULT_BACKUP_SCHEDULE.hourUtc);
  const minuteUtc = Number(input.minuteUtc ?? DEFAULT_BACKUP_SCHEDULE.minuteUtc);
  if (!Number.isInteger(hourUtc) || hourUtc < 0 || hourUtc > 23) {
    throw new Error('Invalid backup schedule hour.');
  }
  if (!Number.isInteger(minuteUtc) || minuteUtc < 0 || minuteUtc > 59) {
    throw new Error('Invalid backup schedule minute.');
  }

  const frequency = input.frequency ?? DEFAULT_BACKUP_SCHEDULE.frequency;
  if (!BACKUP_FREQUENCIES.includes(frequency)) {
    throw new Error('Invalid backup frequency.');
  }

  const dayOfWeek = Number(input.dayOfWeek ?? DEFAULT_BACKUP_SCHEDULE.dayOfWeek);
  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
    throw new Error('Invalid backup schedule dayOfWeek.');
  }

  const dayOfMonth = Number(input.dayOfMonth ?? DEFAULT_BACKUP_SCHEDULE.dayOfMonth);
  if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 28) {
    throw new Error('Invalid backup schedule dayOfMonth.');
  }

  const retentionCountLocal = Number(
    input.retentionCountLocal ?? DEFAULT_BACKUP_SCHEDULE.retentionCountLocal,
  );
  if (!Number.isInteger(retentionCountLocal) || retentionCountLocal < 1 || retentionCountLocal > 365) {
    throw new Error('Invalid backup retentionCountLocal.');
  }

  const retentionCountCloud = Number(
    input.retentionCountCloud ?? DEFAULT_BACKUP_SCHEDULE.retentionCountCloud,
  );
  if (
    !Number.isInteger(retentionCountCloud) ||
    retentionCountCloud < 1 ||
    retentionCountCloud > 3650
  ) {
    throw new Error('Invalid backup retentionCountCloud.');
  }

  return {
    enabled: input.enabled === undefined ? true : Boolean(input.enabled),
    frequency,
    hourUtc,
    minuteUtc,
    dayOfWeek,
    dayOfMonth,
    retentionCountLocal,
    retentionCountCloud,
    timezoneLabel:
      typeof input.timezoneLabel === 'string' && input.timezoneLabel.trim()
        ? input.timezoneLabel.trim()
        : 'UTC',
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : null,
  };
}

/**
 * Returns the ISO timestamp of the next scheduled backup slot strictly
 * **after** `from`. The minute-precision matching in
 * `shouldRunScheduledBackup` is the source of truth for whether a slot
 * actually fires; this function exists for the UI's "next run at …"
 * display.
 */
export function nextBackupRun(schedule, from = new Date()) {
  if (!schedule.enabled) return null;
  // Walk forward minute-by-minute through scheduled slots until the
  // next one strictly after `from`. Bounded loop (max ~366 * 24 * 60
  // for the worst-case monthly preset over a leap year) keeps this
  // dead-simple and trivially correct, no off-by-one wrangling.
  const start = startOfMinute(from);
  for (let offset = 1; offset <= 24 * 60 * 366; offset++) {
    const candidate = new Date(start.getTime() + offset * 60_000);
    if (slotMatches(schedule, candidate)) return candidate.toISOString();
  }
  return null;
}

export function shouldRunScheduledBackup(schedule, now = new Date(), lastRunKey = null) {
  if (!schedule.enabled) return { shouldRun: false, runKey: null };
  if (!slotMatches(schedule, now)) return { shouldRun: false, runKey: null };
  const runKey = scheduledRunKey(schedule, now);
  const shouldRun = runKey !== lastRunKey;
  return { shouldRun, runKey: shouldRun ? runKey : null };
}

/**
 * Is `now` (rounded to the minute) one of the scheduled slots for
 * the given frequency? The dedupe `runKey` is computed separately so
 * we only fire once per slot even if the polling loop sees the minute
 * twice.
 */
function slotMatches(schedule, now) {
  if (now.getUTCMinutes() !== schedule.minuteUtc) return false;
  const hour = now.getUTCHours();
  switch (schedule.frequency) {
    case 'hourly':
      return true;
    case 'every6h':
      // Four slots a day starting at `hourUtc`. Modular distance from
      // the start hour must be a multiple of 6.
      return mod(hour - schedule.hourUtc, 6) === 0;
    case 'every12h':
      return mod(hour - schedule.hourUtc, 12) === 0;
    case 'daily':
      return hour === schedule.hourUtc;
    case 'weekly':
      return hour === schedule.hourUtc && now.getUTCDay() === schedule.dayOfWeek;
    case 'monthly':
      return hour === schedule.hourUtc && now.getUTCDate() === schedule.dayOfMonth;
    default:
      return false;
  }
}

function scheduledRunKey(schedule, now) {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  const hh = String(now.getUTCHours()).padStart(2, '0');
  const mm = String(now.getUTCMinutes()).padStart(2, '0');
  // Slot key always includes the full UTC minute — that uniquely
  // identifies each slot for every frequency.
  return `${year}-${month}-${day}T${hh}:${mm}Z`;
}

function startOfMinute(date) {
  const copy = new Date(date);
  copy.setUTCSeconds(0, 0);
  return copy;
}

function mod(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

/**
 * Group local backup artifacts into sets (by timestamp) and delete
 * everything past the N most-recent sets. Returns a summary so the
 * caller (operation success handler) can log it. Safe to call when
 * the count is already within the limit — it's a no-op then.
 */
export async function enforceLocalRetention(rootDir, retentionCount) {
  if (!Number.isInteger(retentionCount) || retentionCount < 1) {
    return { deletedSets: 0, deletedFiles: [] };
  }
  const nightlyDir = path.join(rootDir, 'backups', 'nightly');
  const artifacts = await listLocalBackupArtifacts(rootDir);
  if (artifacts.length === 0) return { deletedSets: 0, deletedFiles: [] };

  const byTimestamp = new Map();
  for (const artifact of artifacts) {
    const bucket = byTimestamp.get(artifact.timestamp) ?? [];
    bucket.push(artifact);
    byTimestamp.set(artifact.timestamp, bucket);
  }

  const sortedTimestamps = [...byTimestamp.keys()].sort((a, b) => b.localeCompare(a));
  const toDelete = sortedTimestamps.slice(retentionCount);
  const deletedFiles = [];
  for (const timestamp of toDelete) {
    const setArtifacts = byTimestamp.get(timestamp) ?? [];
    for (const artifact of setArtifacts) {
      const filePath = path.join(nightlyDir, artifact.filename);
      try {
        await unlink(filePath);
        deletedFiles.push(artifact.filename);
      } catch {
        // Best-effort: a partially-deleted set isn't a fatal error,
        // the next run will catch any leftover files.
      }
    }
  }
  return { deletedSets: toDelete.length, deletedFiles };
}

/**
 * Derive the `lastBackup` status block from the run history and the newest
 * artifact set. Kept pure (no I/O) so it can be unit-tested.
 *
 * The whole block comes from a SINGLE history record — timestamp, status and
 * error are always from the same run, so we never pair one run's status with a
 * different run's artifact. Restore safety-net backups are recorded as
 * `kind:'restore'` and are intentionally excluded (they're a restore
 * side-effect, not a real backup run). Falls back to the newest artifact with
 * `status:'unknown'` only until the first run has been recorded.
 */
export function deriveLastBackup(history, newestBackup) {
  const lastBackupRun =
    [...(history ?? [])].reverse().find((entry) => entry && entry.kind === 'backup') ?? null;

  if (lastBackupRun) {
    return {
      timestamp:
        lastBackupRun.finishedAt ?? lastBackupRun.startedAt ?? newestBackup?.timestamp ?? '',
      status: lastBackupRun.status ?? 'unknown',
      finishedAt: lastBackupRun.finishedAt ?? null,
      error: lastBackupRun.error ?? null,
      localAvailable: newestBackup?.local?.available ?? false,
      cloudAvailable: newestBackup?.cloud?.available ?? false,
    };
  }

  if (newestBackup) {
    return {
      timestamp: newestBackup.timestamp,
      status: 'unknown',
      finishedAt: null,
      error: null,
      localAvailable: newestBackup.local?.available ?? false,
      cloudAvailable: newestBackup.cloud?.available ?? false,
    };
  }

  return null;
}

function backupSchedulePath(rootDir) {
  return path.join(rootDir, 'data', 'backup-schedule.json');
}

function addArtifacts(map, location, artifacts) {
  for (const artifact of artifacts) {
    const id = artifact.uploadId ?? artifact.timestamp;
    const timestamp = artifact.timestamp;
    const current = map.get(id) ?? buildBackupSet(id, timestamp, [], location);
    if (location === 'local') {
      current.local.available = true;
      current.local.artifacts.push(toDtoArtifact(artifact));
    } else if (location === 'cloud') {
      current.cloud.available = true;
      current.cloud.artifacts.push(toDtoArtifact(artifact));
    } else {
      current.upload = current.upload ?? { available: true, artifacts: [] };
      current.upload.available = true;
      current.upload.artifacts.push(toDtoArtifact(artifact));
    }
    map.set(id, current);
  }
}

function toDtoArtifact(artifact) {
  return {
    kind: artifact.kind,
    filename: artifact.filename,
    sizeBytes: artifact.sizeBytes ?? 0,
    modifiedAt: artifact.modifiedAt ?? new Date().toISOString(),
    encrypted: Boolean(artifact.encrypted),
  };
}
