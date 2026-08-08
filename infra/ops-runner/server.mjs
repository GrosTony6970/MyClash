import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import {
  BACKUP_FILENAME_PATTERN,
  BACKUP_TIMESTAMP_PATTERN,
  backupSetsFromArtifacts,
  buildBackupSet,
  deriveLastBackup,
  enforceLocalRetention,
  expectedBackupArtifactFilenames,
  listLocalBackupArtifacts,
  nextBackupRun,
  parseAwsS3List,
  parseBackupFilename,
  readBackupSchedule,
  shouldRunScheduledBackup,
  writeBackupSchedule,
} from './backup-core.mjs';
import { parseDfOutput } from './disk.mjs';
import { parseDockerInfo } from './host-info.mjs';
import { acquireOpsLock, releaseOpsLock, withOpsLock } from './ops-lock.mjs';

const PORT = Number(process.env.OPS_RUNNER_PORT ?? 4075);
const SECRET = process.env.OPS_RUNNER_SECRET ?? '';
const ROOT_DIR = process.env.MYCLASH_ROOT_DIR ?? '/srv/myclash';
const MAX_BODY_BYTES = Number(process.env.OPS_RUNNER_MAX_BODY_BYTES ?? 1024 * 1024 * 1024);
// Keep the outcome of the last N backup/restore runs so the dashboard can
// report whether the most recent backup actually succeeded (the artifact
// list alone can't tell success from a stale older set).
const BACKUP_HISTORY_LIMIT = 50;
/**
 * Artifact shapes a batched `aws s3 rm --recursive` is allowed to touch. Kept
 * in lockstep with BACKUP_FILENAME_PATTERN / expectedBackupArtifactFilenames:
 * `.gpg` needs its own glob because a trailing-anchored pattern cannot match it.
 */
const CLOUD_ARTIFACT_INCLUDE_GLOBS = [
  'db-*.sql.gz',
  'db-*.sql.gz.gpg',
  'storage-*.tar.gz',
  'storage-*.tar.gz.gpg',
];
/** Keep propagated aws stderr readable in a UI banner. */
const AWS_ERROR_MAX_CHARS = 400;
// Well under the API's own budget for this call, so a stuck daemon surfaces as
// "docker info timed out" rather than as a bare client-side abort.
const HOST_INFO_TIMEOUT_MS = 5_000;
const operations = new Map();
let backupSchedule = await readBackupSchedule(ROOT_DIR);
let lastScheduledRunKey = null;

// Allowlist of compose service names that may be controlled via the lifecycle
// endpoints. Mirrored verbatim by the API's system-actions service for
// defense in depth. Excludes: api (would kill the calling request), postgres
// (data outage), traefik (lose HTTPS for the whole stack), ops-runner (lose
// the channel that would restart anything else).
const CONTAINER_ACTIONS = new Set(['start', 'stop', 'restart']);
const RESTARTABLE_SERVICES = new Set([
  'worker',
  'web-admin',
  'web-public',
  'web-staff',
  'web-marketing',
  'redis',
  'supabase-auth',
  'supabase-realtime',
  'supabase-storage',
  'supabase-rest',
  'supabase-meta',
  'supabase-studio',
]);
const COMPOSE_FLAGS = [
  '--env-file',
  path.join(ROOT_DIR, '.env'),
  '-f',
  'infra/docker-compose.prod.yml',
];

if (!SECRET) {
  console.error('OPS_RUNNER_SECRET is required');
  process.exit(1);
}

const server = createServer(async (req, res) => {
  try {
    if (req.headers.authorization !== `Bearer ${SECRET}`) {
      sendJson(res, 401, { error: 'unauthorized' });
      return;
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (req.method === 'GET' && url.pathname === '/status') {
      sendJson(res, 200, await statusResponse());
      return;
    }
    if (req.method === 'GET' && url.pathname === '/disk') {
      sendJson(res, 200, await diskResponse());
      return;
    }
    if (req.method === 'GET' && url.pathname === '/host') {
      sendJson(res, 200, await hostResponse());
      return;
    }
    if (req.method === 'GET' && url.pathname === '/backups') {
      sendJson(res, 200, await backupsResponse());
      return;
    }
    if (req.method === 'GET' && url.pathname === '/schedule') {
      sendJson(res, 200, scheduleResponse());
      return;
    }
    if (req.method === 'PUT' && url.pathname === '/schedule') {
      backupSchedule = await writeBackupSchedule(ROOT_DIR, await readJsonBody(req));
      sendJson(res, 200, scheduleResponse());
      return;
    }
    if (req.method === 'DELETE' && url.pathname === '/backups') {
      sendJson(res, 200, await deleteAllBackups(await readJsonBody(req)));
      return;
    }
    if (req.method === 'DELETE' && url.pathname.startsWith('/backups/')) {
      sendJson(res, 200, await deleteBackup(url));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/operations/backup') {
      sendJson(
        res,
        202,
        startOperation('backup', () => runScript(['infra/scripts/backup.sh'])),
      );
      return;
    }
    if (req.method === 'POST' && url.pathname === '/operations/restore') {
      const body = await readJsonBody(req);
      sendJson(
        res,
        202,
        startOperation('restore', () => restoreCommand(body), body),
      );
      return;
    }
    if (req.method === 'POST' && url.pathname === '/operations/renew-certs') {
      sendJson(res, 200, await runCertRenewal());
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/operations/')) {
      const id = path.basename(url.pathname);
      sendJson(res, operations.has(id) ? 200 : 404, operations.get(id) ?? { error: 'not_found' });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/uploads') {
      const body = await readJsonBody(req);
      sendJson(res, 201, await stageUpload(body));
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/download/')) {
      await downloadBackup(url, res);
      return;
    }
    const containerMatch = /^\/containers\/([A-Za-z0-9_-]+)\/(start|stop|restart)$/u.exec(
      url.pathname,
    );
    if (req.method === 'POST' && containerMatch) {
      const [, service, action] = containerMatch;
      sendJson(res, 200, await runContainerAction(service, action));
      return;
    }
    sendJson(res, 404, { error: 'not_found' });
  } catch (error) {
    // Honour a status an operation deliberately chose (lock contention is a
    // 409, not a server fault) so the API can relay it as the same class
    // instead of flattening everything into a 503.
    sendJson(res, error?.statusCode ?? 500, { error: sanitizeError(error) });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.info(`MyClash ops runner listening on http://0.0.0.0:${PORT}`);
});

const scheduleTimer = setInterval(() => {
  void maybeRunScheduledBackup();
}, 30_000);
scheduleTimer.unref?.();

async function statusResponse() {
  const backups = (await backupsResponse()).backups;
  const history = await readBackupHistory();
  const runningOperation = [...operations.values()].find((op) => op.status === 'running') ?? null;
  return {
    generatedAt: new Date().toISOString(),
    cloudConfigured: s3Configured(),
    lastBackup: deriveLastBackup(history, backups[0] ?? null),
    runningOperation,
  };
}

async function diskResponse() {
  const result = await spawnCapture('df', ['-P', '-B1', ROOT_DIR]);
  if (result.code !== 0) {
    throw new Error(result.stderr || 'df failed');
  }
  return { generatedAt: new Date().toISOString(), ...parseDfOutput(result.stdout) };
}

/**
 * Host identity and capacity, read from the docker daemon over the socket this
 * sidecar already mounts. The api container has neither the socket nor the host
 * filesystem, which is why this lives here at all.
 *
 * spawnCaptureWithTimeout, not spawnCapture: the latter has no timeout, and a
 * wedged daemon would hold this request open until the API's own abort fires —
 * turning a degraded panel into a stalled one.
 */
async function hostResponse() {
  const result = await spawnCaptureWithTimeout(
    'docker',
    ['info', '--format', '{{json .}}'],
    HOST_INFO_TIMEOUT_MS,
  );
  if (result.timedOut) {
    throw new Error(`docker info timed out after ${HOST_INFO_TIMEOUT_MS}ms`);
  }
  if (result.code !== 0) {
    throw new Error(result.stderr || 'docker info failed');
  }
  return { generatedAt: new Date().toISOString(), ...parseDockerInfo(result.stdout) };
}

async function backupsResponse() {
  const localArtifacts = await listLocalBackupArtifacts(ROOT_DIR);
  const cloudArtifacts = await listCloudArtifacts();
  return {
    generatedAt: new Date().toISOString(),
    backups: backupSetsFromArtifacts({ localArtifacts, cloudArtifacts }),
  };
}

function scheduleResponse() {
  return {
    ...backupSchedule,
    nextRunAt: nextBackupRun(backupSchedule),
  };
}

function backupHistoryPath() {
  return path.join(ROOT_DIR, 'data', 'backup-history.json');
}

async function readBackupHistory() {
  try {
    const text = await readFile(backupHistoryPath(), 'utf8');
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Record the outcome of a finished operation to a small bounded ring on
 * disk, written atomically (temp + rename) so a concurrent /status read
 * never sees a torn file.
 */
async function appendBackupHistory(operation) {
  const record = {
    id: operation.id,
    kind: operation.kind,
    status: operation.status,
    startedAt: operation.startedAt,
    finishedAt: operation.finishedAt ?? new Date().toISOString(),
    scheduled: Boolean(operation.scheduled),
    backupId: operation.backupId ?? null,
    source: operation.source ?? null,
    error: operation.error ?? null,
  };
  const history = await readBackupHistory();
  history.push(record);
  const trimmed = history.slice(-BACKUP_HISTORY_LIMIT);
  const filePath = backupHistoryPath();
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(trimmed, null, 2)}\n`, 'utf8');
  await rename(tmpPath, filePath);
}

async function maybeRunScheduledBackup(now = new Date()) {
  const decision = shouldRunScheduledBackup(backupSchedule, now, lastScheduledRunKey);
  if (!decision.shouldRun || !decision.runKey) return;
  lastScheduledRunKey = decision.runKey;
  const runningOperation = [...operations.values()].find((op) => op.status === 'running');
  if (runningOperation) return;
  startOperation('backup', () => runScript(['infra/scripts/backup.sh']), {
    scheduled: true,
  });
}

/**
 * @param throwOnFailure callers that are about to DELETE must not read an
 *   unreachable bucket as an empty one — "0 cloud sets deleted, success" is a
 *   lie the operator cannot distinguish from a real wipe. Listing callers keep
 *   the lenient default so a cloud outage degrades the inventory view instead
 *   of breaking it.
 */
async function listCloudArtifacts({ throwOnFailure = false } = {}) {
  if (!s3Configured()) return [];
  const result = await spawnCapture('aws', [
    's3',
    'ls',
    `s3://${process.env.BACKUP_SCW_BUCKET}/myclash/`,
    '--endpoint-url',
    process.env.BACKUP_SCW_ENDPOINT,
  ]);
  if (result.code !== 0) {
    if (throwOnFailure) {
      throw new Error(trimAwsError(result.stderr) || 'Could not list cloud backups.');
    }
    return [];
  }
  return parseAwsS3List(result.stdout)
    .map((entry) => {
      const parsed = parseBackupFilename(entry.key);
      return parsed
        ? {
            ...parsed,
            sizeBytes: entry.sizeBytes,
            modifiedAt: entry.modifiedAt,
          }
        : null;
    })
    .filter(Boolean);
}

function startOperation(kind, createCommand, body = {}) {
  const operation = {
    id: randomUUID(),
    kind,
    status: 'running',
    startedAt: new Date().toISOString(),
    source: body.location,
    backupId: body.backupId,
    scheduled: Boolean(body.scheduled),
    logTail: [],
  };
  operations.set(operation.id, operation);
  void runLocked(operation, createCommand);
  return { operation };
}

/**
 * Announce a reclaimed lock in the container log. A wedged runner used to need
 * an operator to SSH in and delete the file; now it heals itself, so the only
 * trace left is this line — keep it loud enough to correlate with a crash.
 */
function logReclaimedLock(state) {
  console.warn(
    `[ops-lock] reclaimed a stale lock (${state.reason}); previous holder: ` +
      `${state.holder?.kind ?? 'unknown'} ${state.holder?.operationId ?? ''} started ${state.holder?.startedAt ?? 'unknown'}`,
  );
}

async function runLocked(operation, createCommand) {
  let handle;
  try {
    handle = await acquireOpsLock(ROOT_DIR, {
      kind: operation.kind,
      operationId: operation.id,
      onReclaim: logReclaimedLock,
    });
  } catch (error) {
    operation.status = 'failed';
    operation.error = sanitizeError(error);
    operation.finishedAt = new Date().toISOString();
    return;
  }

  try {
    if (operation.kind === 'restore') {
      await appendProcess(operation, ['bash', 'infra/scripts/backup.sh']);
    }
    await appendProcess(operation, await createCommand());
    operation.status = 'success';
    // Retention enforcement runs after a successful backup, never on
    // restore — restore creates a safety-net backup but that's the
    // single artifact we'd be pruning otherwise.
    if (operation.kind === 'backup') {
      await runRetentionAfterBackup(operation);
    }
  } catch (error) {
    operation.status = 'failed';
    operation.error = sanitizeError(error);
  } finally {
    operation.finishedAt = new Date().toISOString();
    await appendBackupHistory(operation).catch(() => undefined);
    await releaseOpsLock(handle);
  }
}

async function runRetentionAfterBackup(operation) {
  try {
    const localSummary = await enforceLocalRetention(ROOT_DIR, backupSchedule.retentionCountLocal);
    if (localSummary.deletedSets > 0) {
      addLog(
        operation,
        `[retention] local: pruned ${localSummary.deletedSets} set(s), ${localSummary.deletedFiles.length} file(s)\n`,
      );
    }
    if (s3Configured()) {
      const cloudSummary = await enforceCloudRetention(backupSchedule.retentionCountCloud);
      if (cloudSummary.deletedSets > 0) {
        addLog(
          operation,
          `[retention] cloud: pruned ${cloudSummary.deletedSets} set(s), ${cloudSummary.deletedFiles.length} file(s)\n`,
        );
      }
    }
  } catch (error) {
    // Retention is best-effort: log it and move on. A retention failure
    // must not flip a successful backup to "failed" — the data is safe.
    addLog(operation, `[retention] WARN ${sanitizeError(error)}\n`);
  }
}

/**
 * Cloud-side count-based retention. Mirrors `enforceLocalRetention` but
 * groups S3 artifacts (already parsed by `listCloudArtifacts`) by
 * timestamp and shells out to `aws s3 rm` for each over-quota artifact.
 * Only meaningful when `s3Configured()` is true — caller must check.
 */
async function enforceCloudRetention(retentionCount) {
  if (!Number.isInteger(retentionCount) || retentionCount < 1) {
    return { deletedSets: 0, deletedFiles: [] };
  }
  const artifacts = await listCloudArtifacts();
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
      const result = await spawnCapture('aws', [
        's3',
        'rm',
        `s3://${process.env.BACKUP_SCW_BUCKET}/myclash/${artifact.filename}`,
        '--endpoint-url',
        process.env.BACKUP_SCW_ENDPOINT,
      ]);
      if (result.code === 0) deletedFiles.push(artifact.filename);
    }
  }
  return { deletedSets: toDelete.length, deletedFiles };
}

/**
 * Wipe every local + S3 backup artifact in one shot. Requires a
 * literal confirmation token to guard against an accidental click;
 * the same token shape used for `restore`'s confirmation pattern.
 */
async function deleteAllBackups(body) {
  if (!body || body.confirmation !== 'DELETE ALL MYCLASH BACKUPS') {
    throw new Error('Invalid confirmation.');
  }

  // Mutual exclusion with backup/restore. Without it a wipe can delete
  // artifacts while backup.sh is still writing them, or strip away the
  // safety-net backup a restore just took. Stays synchronous: the batched S3
  // delete below keeps this inside the API's request budget.
  return withOpsLock(ROOT_DIR, { kind: 'delete-all', onReclaim: logReclaimedLock }, async () => {
    const local = await deleteAllLocalBackups();
    const cloud = s3Configured() ? await deleteAllCloudBackups() : emptyWipe();

    return {
      deleted: true,
      deletedLocalSets: local.timestamps.size,
      deletedCloudSets: cloud.timestamps.size,
      deletedFiles: [...local.deletedFiles, ...cloud.deletedFiles],
      failedFiles: local.failedFiles,
    };
  });
}

function emptyWipe() {
  return { deletedFiles: [], failedFiles: [], timestamps: new Set() };
}

async function deleteAllLocalBackups() {
  const artifacts = await listLocalBackupArtifacts(ROOT_DIR);
  const wipe = emptyWipe();
  for (const artifact of artifacts) {
    try {
      await rm(path.join(ROOT_DIR, 'backups', 'nightly', artifact.filename), { force: true });
      wipe.deletedFiles.push(artifact.filename);
      wipe.timestamps.add(artifact.timestamp);
    } catch {
      // Best-effort per file, but reported rather than discarded — a wipe that
      // silently left files behind is worse than one that says so.
      wipe.failedFiles.push(artifact.filename);
    }
  }
  return wipe;
}

/**
 * ONE batched delete, not one `aws` process per object: the CLI costs ~1-2s of
 * cold start each, and at 60 retained sets the per-object loop needed ~120
 * spawns — minutes past the API's 15s timeout, which is why this endpoint
 * appeared to fail while quietly succeeding underneath.
 */
async function deleteAllCloudBackups() {
  const artifacts = await listCloudArtifacts({ throwOnFailure: true });
  if (artifacts.length === 0) return emptyWipe();

  const result = await spawnCapture('aws', [
    's3',
    'rm',
    `s3://${process.env.BACKUP_SCW_BUCKET}/myclash/`,
    '--recursive',
    // Filters apply in order: deny everything, then re-admit only the backup
    // artifact shapes, so --recursive can never reach a key this subsystem
    // does not own.
    '--exclude',
    '*',
    ...CLOUD_ARTIFACT_INCLUDE_GLOBS.flatMap((glob) => ['--include', glob]),
    '--endpoint-url',
    process.env.BACKUP_SCW_ENDPOINT,
  ]);
  if (result.code !== 0) {
    throw new Error(trimAwsError(result.stderr) || 'Could not delete cloud backups.');
  }

  return {
    deletedFiles: artifacts.map((artifact) => artifact.filename),
    failedFiles: [],
    timestamps: new Set(artifacts.map((artifact) => artifact.timestamp)),
  };
}

async function restoreCommand(body) {
  if (!body || typeof body !== 'object') throw new Error('Invalid restore payload.');
  const { location, backupId, includeStorage = true, confirmation } = body;
  if (!['local', 's3', 'upload'].includes(location)) throw new Error('Invalid restore location.');
  if (confirmation !== `RESTORE MYCLASH ${backupId}`) throw new Error('Invalid confirmation.');

  if (location === 's3') {
    assertTimestamp(backupId);
    return ['bash', 'infra/scripts/restore.sh', '--from-s3', backupId, '--yes'];
  }

  const dbPath =
    location === 'upload'
      ? await findUploadedDbBackup(backupId)
      : await findLocalDbBackup(assertTimestamp(backupId));
  return [
    'bash',
    'infra/scripts/restore.sh',
    dbPath,
    '--yes',
    includeStorage ? '--include-storage' : '--db-only',
  ];
}

async function stageUpload(body) {
  if (!body || typeof body !== 'object') throw new Error('Invalid upload payload.');
  const rawFilename = String(body.filename ?? '');
  const filename = path.basename(rawFilename);
  if (filename !== rawFilename) throw new Error('Unsupported backup filename.');
  if (!BACKUP_FILENAME_PATTERN.test(filename)) throw new Error('Unsupported backup filename.');
  const parsed = parseBackupFilename(filename);
  const uploadId = `upload-${parsed.timestamp}-${randomUUID().slice(0, 8)}`;
  const uploadDir = path.join(ROOT_DIR, 'backups', 'uploads', uploadId);
  await mkdir(uploadDir, { recursive: true });
  const uploadPath = path.join(uploadDir, filename);
  await writeFile(uploadPath, Buffer.from(String(body.contentBase64), 'base64'));
  // Reject corrupt/truncated uploads up front so a bad artifact can never be
  // selected for restore. Encrypted .gpg blobs can't be introspected without
  // the private key, so integrity there is only verified at restore time.
  if (!parsed.encrypted) {
    const gz = await spawnCapture('gzip', ['-t', uploadPath]);
    if (gz.code !== 0) {
      await rm(uploadDir, { recursive: true, force: true }).catch(() => undefined);
      throw new Error('Uploaded backup failed integrity check (corrupt or truncated gzip).');
    }
  }
  const fileStat = await stat(uploadPath);
  const artifact = {
    ...parsed,
    uploadId,
    sizeBytes: fileStat.size,
    modifiedAt: fileStat.mtime.toISOString(),
  };
  return { backup: buildBackupSet(uploadId, parsed.timestamp, [artifact], 'upload') };
}

async function downloadBackup(url, res) {
  const backupId = path.basename(url.pathname);
  const location = url.searchParams.get('location') ?? 'local';
  const artifact = url.searchParams.get('artifact') ?? 'db';
  if (!['db', 'storage', 'bundle'].includes(artifact)) throw new Error('Invalid artifact.');
  if (!['local', 's3', 'upload'].includes(location)) throw new Error('Invalid location.');

  const filePath =
    location === 'upload'
      ? await findUploadedArtifact(backupId, artifact)
      : location === 's3'
        ? await downloadS3Artifact(assertTimestamp(backupId), artifact)
        : await findLocalArtifact(assertTimestamp(backupId), artifact);

  res.writeHead(200, {
    'content-type': 'application/octet-stream',
    'content-disposition': `attachment; filename="${path.basename(filePath)}"`,
  });
  createReadStream(filePath).pipe(res);
}

async function deleteBackup(url) {
  const backupId = path.basename(url.pathname);
  const location = url.searchParams.get('location') ?? 'local';
  if (!['local', 's3'].includes(location)) throw new Error('Invalid backup location.');
  const timestamp = assertTimestamp(backupId);
  const deletedArtifacts =
    location === 's3'
      ? await deleteS3BackupArtifacts(timestamp)
      : await deleteLocalBackupArtifacts(timestamp);
  if (deletedArtifacts.length === 0) throw new Error('No backup artifacts found to delete.');
  return { deleted: true, backupId: timestamp, location, deletedArtifacts };
}

async function deleteLocalBackupArtifacts(timestamp) {
  const artifacts = await listLocalBackupArtifacts(ROOT_DIR);
  const candidates = new Set(
    artifacts
      .filter((artifact) => artifact.timestamp === timestamp)
      .map((artifact) => artifact.filename),
  );
  const deleted = [];
  for (const filename of expectedBackupArtifactFilenames(timestamp)) {
    if (!candidates.has(filename)) continue;
    await rm(path.join(ROOT_DIR, 'backups', 'nightly', filename), { force: true });
    deleted.push(filename);
  }
  return deleted;
}

async function deleteS3BackupArtifacts(timestamp) {
  if (!s3Configured()) throw new Error('Scaleway S3 is not configured.');
  const artifacts = await listCloudArtifacts();
  const candidates = artifacts
    .filter((artifact) => artifact.timestamp === timestamp)
    .map((artifact) => artifact.filename);
  const deleted = [];
  for (const filename of candidates) {
    const result = await spawnCapture('aws', [
      's3',
      'rm',
      `s3://${process.env.BACKUP_SCW_BUCKET}/myclash/${filename}`,
      '--endpoint-url',
      process.env.BACKUP_SCW_ENDPOINT,
    ]);
    if (result.code !== 0) throw new Error(result.stderr || `Could not delete ${filename}.`);
    deleted.push(filename);
  }
  return deleted;
}

async function findLocalDbBackup(timestamp) {
  return findLocalArtifact(timestamp, 'db');
}

async function findLocalArtifact(timestamp, artifact) {
  const kind = artifact === 'storage' ? 'storage' : 'db';
  const base = kind === 'storage' ? `storage-${timestamp}.tar.gz` : `db-${timestamp}.sql.gz`;
  for (const candidate of [base, `${base}.gpg`]) {
    const filePath = path.join(ROOT_DIR, 'backups', 'nightly', candidate);
    if (await fileExists(filePath)) return filePath;
  }
  throw new Error('Backup artifact not found.');
}

async function findUploadedDbBackup(uploadId) {
  return findUploadedArtifact(uploadId, 'db');
}

async function findUploadedArtifact(uploadId, artifact) {
  if (!/^upload-\d{8}T\d{6}Z-[A-Za-z0-9_-]{8}$/.test(uploadId)) {
    throw new Error('Invalid upload identifier.');
  }
  const uploadDir = path.join(ROOT_DIR, 'backups', 'uploads', uploadId);
  const entries = await import('node:fs/promises').then((fs) => fs.readdir(uploadDir));
  const match = entries.find((entry) => {
    const parsed = parseBackupFilename(entry);
    return parsed && (artifact === 'bundle' || parsed.kind === artifact);
  });
  if (!match) throw new Error('Uploaded backup artifact not found.');
  return path.join(uploadDir, match);
}

async function downloadS3Artifact(timestamp, artifact) {
  if (!s3Configured()) throw new Error('Scaleway S3 is not configured.');
  const kind = artifact === 'storage' ? 'storage' : 'db';
  const base = kind === 'storage' ? `storage-${timestamp}.tar.gz` : `db-${timestamp}.sql.gz`;
  const tempDir = path.join(ROOT_DIR, 'backups', 'tmp-downloads');
  await mkdir(tempDir, { recursive: true });
  for (const candidate of [base, `${base}.gpg`]) {
    const s3Path = `s3://${process.env.BACKUP_SCW_BUCKET}/myclash/${candidate}`;
    const target = path.join(tempDir, candidate);
    const result = await spawnCapture('aws', [
      's3',
      'cp',
      s3Path,
      target,
      '--endpoint-url',
      process.env.BACKUP_SCW_ENDPOINT,
      '--no-progress',
    ]);
    if (result.code === 0) return target;
  }
  throw new Error('Cloud backup artifact not found.');
}

async function appendProcess(operation, command) {
  await new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), {
      cwd: ROOT_DIR,
      env: {
        ...process.env,
        MYCLASH_RESTORE_CONFIRM: '1',
        AWS_ACCESS_KEY_ID: process.env.BACKUP_SCW_ACCESS_KEY ?? '',
        AWS_SECRET_ACCESS_KEY: process.env.BACKUP_SCW_SECRET_KEY ?? '',
        AWS_DEFAULT_REGION: process.env.BACKUP_SCW_REGION ?? 'fr-par',
      },
    });
    child.stdout.on('data', (chunk) => addLog(operation, chunk));
    child.stderr.on('data', (chunk) => addLog(operation, chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command[0]} exited with ${code}`));
    });
  });
}

function runScript(args) {
  return Promise.resolve(['bash', ...args]);
}

/**
 * Run a `docker compose <action> <service>` against the production compose
 * file. Bounded to the RESTARTABLE_SERVICES allowlist; rejects everything
 * else with 400/403. Times out after 30 s and returns the captured stdio.
 */
async function runContainerAction(service, action) {
  if (!CONTAINER_ACTIONS.has(action)) {
    return { ok: false, error: 'invalid_action' };
  }
  if (!RESTARTABLE_SERVICES.has(service)) {
    return { ok: false, error: 'service_not_allowed' };
  }
  const result = await spawnCaptureWithTimeout(
    'docker',
    ['compose', ...COMPOSE_FLAGS, action, service],
    30_000,
  );
  return {
    ok: result.code === 0,
    service,
    action,
    exitCode: result.code,
    stdout: result.stdout.slice(-4000),
    stderr: result.stderr.slice(-4000),
    timedOut: result.timedOut ?? false,
  };
}

/**
 * Force a Let's Encrypt renewal attempt by restarting Traefik. On boot Traefik
 * re-runs its ACME resolver and renews any cert already inside its ~30-day
 * window; `acme.json` is never touched, so there is no LE rate-limit risk.
 *
 * This is a deliberate, single-purpose exception to the RESTARTABLE_SERVICES
 * allowlist (which excludes `traefik` on purpose): it can only *restart*
 * Traefik — never stop it — so HTTPS returns within a couple of seconds.
 */
async function runCertRenewal() {
  const result = await spawnCaptureWithTimeout(
    'docker',
    ['compose', ...COMPOSE_FLAGS, 'restart', 'traefik'],
    30_000,
  );
  return {
    ok: result.code === 0,
    service: 'traefik',
    action: 'renew-certs',
    exitCode: result.code,
    stdout: result.stdout.slice(-4000),
    stderr: result.stderr.slice(-4000),
    timedOut: result.timedOut ?? false,
  };
}

/**
 * Same shape as spawnCapture(), but kills the child after `timeoutMs` and
 * surfaces a `timedOut: true` flag so callers can distinguish "process
 * exited non-zero" from "we never heard back".
 */
async function spawnCaptureWithTimeout(command, args, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: ROOT_DIR, env: process.env });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: error.message, timedOut });
    });
  });
}

async function spawnCapture(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: ROOT_DIR,
      env: {
        ...process.env,
        AWS_ACCESS_KEY_ID: process.env.BACKUP_SCW_ACCESS_KEY ?? '',
        AWS_SECRET_ACCESS_KEY: process.env.BACKUP_SCW_SECRET_KEY ?? '',
        AWS_DEFAULT_REGION: process.env.BACKUP_SCW_REGION ?? 'fr-par',
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.on('error', (error) => resolve({ code: 1, stdout, stderr: error.message }));
  });
}

async function readJsonBody(req) {
  let body = '';
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('Request body too large.');
    body += chunk;
  }
  return body ? JSON.parse(body) : {};
}

function sendJson(res, statusCode, value) {
  res.writeHead(statusCode, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(`${JSON.stringify(value)}\n`);
}

function addLog(operation, chunk) {
  const lines = String(chunk)
    .replace(/\x1B\[[0-9;]*m/g, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  operation.logTail.push(...lines);
  operation.logTail = operation.logTail.slice(-80);
}

function s3Configured() {
  return Boolean(
    process.env.BACKUP_SCW_ACCESS_KEY &&
    process.env.BACKUP_SCW_SECRET_KEY &&
    process.env.BACKUP_SCW_BUCKET &&
    process.env.BACKUP_SCW_ENDPOINT,
  );
}

function assertTimestamp(value) {
  if (!BACKUP_TIMESTAMP_PATTERN.test(String(value))) throw new Error('Invalid backup timestamp.');
  return String(value);
}

async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function sanitizeError(error) {
  return error instanceof Error ? error.message : 'Unknown operation error.';
}

/**
 * Collapse aws-cli stderr into one bounded line. These messages reach a
 * super-admin-only UI, so operational detail (endpoint, bucket) is acceptable
 * — a wall of retry noise is not.
 */
function trimAwsError(stderr) {
  const text = String(stderr ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ');
  return text.length > AWS_ERROR_MAX_CHARS ? `${text.slice(0, AWS_ERROR_MAX_CHARS)}…` : text;
}
