import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, open, rm, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import {
  BACKUP_FILENAME_PATTERN,
  BACKUP_TIMESTAMP_PATTERN,
  backupSetsFromArtifacts,
  buildBackupSet,
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

const PORT = Number(process.env.OPS_RUNNER_PORT ?? 4075);
const SECRET = process.env.OPS_RUNNER_SECRET ?? '';
const ROOT_DIR = process.env.MYCLASH_ROOT_DIR ?? '/srv/myclash';
const MAX_BODY_BYTES = Number(process.env.OPS_RUNNER_MAX_BODY_BYTES ?? 1024 * 1024 * 1024);
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
  'web-scoring',
  'web-marketing',
  'redis',
  'supabase-auth',
  'supabase-realtime',
  'supabase-storage',
  'supabase-rest',
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
    sendJson(res, 500, { error: sanitizeError(error) });
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
  const runningOperation = [...operations.values()].find((op) => op.status === 'running') ?? null;
  return {
    generatedAt: new Date().toISOString(),
    cloudConfigured: s3Configured(),
    lastBackup: backups[0]
      ? {
          timestamp: backups[0].timestamp,
          status: 'unknown',
          localAvailable: backups[0].local.available,
          cloudAvailable: backups[0].cloud.available,
        }
      : null,
    runningOperation,
  };
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

async function listCloudArtifacts() {
  if (!s3Configured()) return [];
  const result = await spawnCapture('aws', [
    's3',
    'ls',
    `s3://${process.env.BACKUP_SCW_BUCKET}/myclash/`,
    '--endpoint-url',
    process.env.BACKUP_SCW_ENDPOINT,
  ]);
  if (result.code !== 0) return [];
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
    logTail: [],
  };
  operations.set(operation.id, operation);
  void runLocked(operation, createCommand);
  return { operation };
}

async function runLocked(operation, createCommand) {
  const lockPath = path.join(ROOT_DIR, 'backups', '.ops.lock');
  await mkdir(path.dirname(lockPath), { recursive: true });
  let lock;
  try {
    lock = await open(lockPath, 'wx');
  } catch {
    operation.status = 'failed';
    operation.error = 'Another backup operation is already running.';
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
    await lock.close().catch(() => undefined);
    await rm(lockPath, { force: true }).catch(() => undefined);
  }
}

async function runRetentionAfterBackup(operation) {
  try {
    const localSummary = await enforceLocalRetention(
      ROOT_DIR,
      backupSchedule.retentionCountLocal,
    );
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

  const localArtifacts = await listLocalBackupArtifacts(ROOT_DIR);
  const deletedFiles = [];
  const localTimestamps = new Set();
  for (const artifact of localArtifacts) {
    try {
      await rm(path.join(ROOT_DIR, 'backups', 'nightly', artifact.filename), { force: true });
      deletedFiles.push(artifact.filename);
      localTimestamps.add(artifact.timestamp);
    } catch {
      // Best-effort, continue with the remaining files.
    }
  }

  const cloudTimestamps = new Set();
  if (s3Configured()) {
    const cloudArtifacts = await listCloudArtifacts();
    for (const artifact of cloudArtifacts) {
      const result = await spawnCapture('aws', [
        's3',
        'rm',
        `s3://${process.env.BACKUP_SCW_BUCKET}/myclash/${artifact.filename}`,
        '--endpoint-url',
        process.env.BACKUP_SCW_ENDPOINT,
      ]);
      if (result.code === 0) {
        deletedFiles.push(artifact.filename);
        cloudTimestamps.add(artifact.timestamp);
      }
    }
  }

  return {
    deleted: true,
    deletedLocalSets: localTimestamps.size,
    deletedCloudSets: cloudTimestamps.size,
    deletedFiles,
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
  await writeFile(
    path.join(uploadDir, filename),
    Buffer.from(String(body.contentBase64), 'base64'),
  );
  const fileStat = await stat(path.join(uploadDir, filename));
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
