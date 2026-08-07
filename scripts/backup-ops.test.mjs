import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  backupSetsFromArtifacts,
  DEFAULT_BACKUP_SCHEDULE,
  nextBackupRun,
  normalizeBackupSchedule,
  readBackupSchedule,
  listLocalBackupArtifacts,
  parseAwsS3List,
  parseBackupFilename,
  shouldRunScheduledBackup,
  writeBackupSchedule,
} from '../infra/ops-runner/backup-core.mjs';

const repoRoot = path.join(import.meta.dirname, '..');
const readRepoFile = (...segments) => readFile(path.join(repoRoot, ...segments), 'utf8');

// server.mjs calls createServer()/listen() and awaits at the top level, so it
// cannot be imported from a test. Its wiring is pinned by assertion instead —
// the same approach as infra/ops-runner/restore-script-guard.test.mjs.
test('delete-all wipes the cloud in ONE batched aws call, fenced to backup artifacts', async () => {
  const server = await readRepoFile('infra', 'ops-runner', 'server.mjs');

  assert.match(server, /'--recursive'/, 'delete-all must use a single recursive S3 delete');
  // Filters apply in order: deny-all first, then re-admit only artifact shapes.
  // Without the leading exclude, --recursive would wipe the whole prefix.
  assert.match(
    server,
    /'--exclude',\s*\n?\s*'\*',/,
    "a batched --recursive delete must be fenced by --exclude '*'",
  );
  assert.match(server, /CLOUD_ARTIFACT_INCLUDE_GLOBS/);

  // A per-object loop is what blew the API's 15s timeout; catching its return
  // is what turned a total S3 failure into a reported success.
  assert.doesNotMatch(
    server,
    /for \(const artifact of cloudArtifacts\) \{\s*\n\s*const result = await spawnCapture/,
    'delete-all must not spawn one aws process per cloud artifact',
  );
  assert.match(
    server,
    /if \(result\.code !== 0\) \{\s*\n\s*throw new Error\(trimAwsError/,
    'a failed batched delete must throw, not be swallowed',
  );
  assert.match(
    server,
    /listCloudArtifacts\(\{ throwOnFailure: true \}\)/,
    'a delete must not read an unreachable bucket as an empty one',
  );
});

test('every mutating ops operation runs under the shared lock', async () => {
  const server = await readRepoFile('infra', 'ops-runner', 'server.mjs');

  assert.match(
    server,
    /withOpsLock\(ROOT_DIR, \{ kind: 'delete-all'/,
    'delete-all must take the lock',
  );
  assert.match(server, /handle = await acquireOpsLock\(ROOT_DIR/, 'runLocked must take the lock');
  assert.match(server, /await releaseOpsLock\(handle\)/);
  // The old contentless lock left no way to tell a live holder from a crashed
  // one, which is what wedged the runner permanently after a container kill.
  assert.doesNotMatch(server, /open\(lockPath, 'wx'\)/, 'the contentless lock must not come back');
  assert.match(
    server,
    /error\?\.statusCode \?\? 500/,
    'lock contention must surface as its own status, not a blanket 500',
  );
});

test('backup.sh cannot mistake a missing docker compose for a stopped database', async () => {
  const backup = await readRepoFile('infra', 'scripts', 'backup.sh');

  // `ps --status running db 2>/dev/null` returns nothing either way, so the
  // tool has to be probed separately or a broken image reports a stopped DB.
  assert.match(
    backup,
    /if ! "\$\{COMPOSE\[@\]\}" version >\/dev\/null 2>&1; then/,
    'backup.sh must probe docker compose before probing the db container',
  );
  assert.match(backup, /docker compose unavailable in this environment/);

  // A DB-only backup used to exit 0 and be recorded as a success.
  assert.match(
    backup,
    /Storage volume '\$STORAGE_VOLUME' not found — backup is incomplete"\n\s*BACKUP_OK=0/,
    'a missing storage volume must fail the run, not just warn',
  );
});

test('the ops-runner image ships the compose plugin the ops scripts require', async () => {
  const dockerfile = await readRepoFile('infra', 'ops-runner', 'Dockerfile');

  assert.match(dockerfile, /docker-compose-plugin/);
  assert.doesNotMatch(
    dockerfile,
    /^\s+docker\.io/mu,
    "Debian's docker.io has no Compose v2 plugin; use docker-ce-cli + docker-compose-plugin",
  );
  assert.match(
    dockerfile,
    /RUN docker compose version/,
    'the image must fail to build rather than fail every nightly backup',
  );
});

test('parses MyClash backup filenames safely', () => {
  assert.deepEqual(parseBackupFilename('db-20260505T030000Z.sql.gz'), {
    kind: 'db',
    timestamp: '20260505T030000Z',
    filename: 'db-20260505T030000Z.sql.gz',
    encrypted: false,
  });
  assert.deepEqual(parseBackupFilename('storage-20260505T030000Z.tar.gz.gpg'), {
    kind: 'storage',
    timestamp: '20260505T030000Z',
    filename: 'storage-20260505T030000Z.tar.gz.gpg',
    encrypted: true,
  });
  assert.equal(parseBackupFilename('../db-20260505T030000Z.sql.gz'), null);
  assert.equal(parseBackupFilename('db-latest.sql.gz'), null);
});

test('groups local and Scaleway S3 artifacts by timestamp', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'myclash-backup-ops-'));
  const nightlyDir = path.join(rootDir, 'backups', 'nightly');
  await mkdir(nightlyDir, { recursive: true });
  await writeFile(path.join(nightlyDir, 'db-20260505T030000Z.sql.gz'), 'db');
  await writeFile(path.join(nightlyDir, 'storage-20260505T030000Z.tar.gz'), 'storage');

  const localArtifacts = await listLocalBackupArtifacts(rootDir);
  const cloudArtifacts = parseAwsS3List(
    [
      '2026-05-05 03:01:00         20 db-20260505T030000Z.sql.gz',
      '2026-05-05 03:02:00         40 storage-20260505T030000Z.tar.gz',
    ].join('\n'),
  ).map((entry) => ({ ...parseBackupFilename(entry.key), ...entry }));

  const sets = backupSetsFromArtifacts({ localArtifacts, cloudArtifacts });

  assert.equal(sets.length, 1);
  assert.equal(sets[0].id, '20260505T030000Z');
  assert.equal(sets[0].local.available, true);
  assert.equal(sets[0].cloud.available, true);
  assert.equal(sets[0].local.artifacts.length, 2);
  assert.equal(sets[0].cloud.artifacts.length, 2);
});

test('reads missing backup schedule as default 03:00 UTC', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'myclash-backup-schedule-'));

  const schedule = await readBackupSchedule(rootDir);

  // Compare against the exported default rather than a hand-copied literal.
  // The literal version of this rotted the moment the schedule gained
  // frequency / dayOfWeek / dayOfMonth / retention fields, and nothing caught
  // it because nothing ran these tests. This asserts the CONTRACT — "no file
  // on disk yields the documented default" — which cannot drift.
  assert.deepEqual(schedule, DEFAULT_BACKUP_SCHEDULE);
  assert.equal(
    nextBackupRun(schedule, new Date('2026-05-18T02:30:00Z')),
    '2026-05-18T03:00:00.000Z',
  );
});

test('persists editable backup schedule', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'myclash-backup-schedule-'));

  const schedule = await writeBackupSchedule(rootDir, {
    enabled: false,
    hourUtc: 22,
    minuteUtc: 45,
    timezoneLabel: 'UTC',
  });
  const fileText = await readFile(path.join(rootDir, 'data', 'backup-schedule.json'), 'utf8');

  assert.equal(schedule.enabled, false);
  assert.equal(schedule.hourUtc, 22);
  assert.equal(schedule.minuteUtc, 45);
  assert.match(schedule.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(JSON.parse(fileText).hourUtc, 22);
});

test('detects scheduled backup minute once per run key', () => {
  // Built through normalizeBackupSchedule, not hand-rolled. A literal object
  // silently omitted `frequency`, so slotMatches fell through its switch to
  // `default: return false` and the test failed against perfectly correct
  // production code.
  const schedule = normalizeBackupSchedule({ hourUtc: 3, minuteUtc: 0 });

  const first = shouldRunScheduledBackup(schedule, new Date('2026-05-18T03:00:05Z'));
  const duplicate = shouldRunScheduledBackup(
    schedule,
    new Date('2026-05-18T03:00:40Z'),
    first.runKey,
  );

  assert.equal(first.shouldRun, true);
  assert.equal(first.runKey, '2026-05-18T03:00Z');
  assert.equal(duplicate.shouldRun, false);
});
