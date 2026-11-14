/**
 * infra/scripts/lib/db-running.sh: the one reading of "is the database container running?"
 * that backup.sh and deploy.sh share.
 *
 * A `docker compose ps` that fails is `unknown`, with compose's last line as the reason, never
 * `stopped`: read as stopped, the nightly backup said "DB container not running" and deploy.sh
 * went on with no pre-deploy backup.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LIB = join(REPO, 'infra/scripts/lib/db-running.sh').replaceAll('\\', '/');
// Git Bash on Windows: System32's bash.exe is WSL, which cannot read a Windows PATH.
const BASH = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const skip = process.platform === 'win32' && !existsSync(BASH) ? 'needs Git Bash' : false;

const ORPHAN_WARNING = 'level=warning msg=Found orphan containers ([myclash-db-1])';

/**
 * Runs mc_db_state under the scripts' own shell options, with COMPOSE pointing at a fake that
 * answers `ps --status running --services` with `answer` and any other argv as a failure:
 * without --services compose prints a table, and without --status running it lists a stopped
 * db too, so a dropped flag turns every case below red.
 */
function dbState(answer) {
  const script = [
    'set -Eeuo pipefail',
    'source "$0"',
    'fake_compose() {',
    '  if [[ "$*" != "ps --status running --services" ]]; then echo "unexpected: $*" >&2; return 2; fi',
    '  eval "$ANSWER"',
    '}',
    'COMPOSE=(fake_compose)',
    'mc_db_state',
    'printf "%s|%s" "$MC_DB_STATE" "$MC_DB_PS_REASON"',
  ].join('\n');
  const run = spawnSync(BASH, ['-c', script, LIB], {
    env: { ...process.env, ANSWER: answer },
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout;
}

test('a running db service is running, whatever compose warns about', { skip }, () => {
  assert.equal(dbState(`echo "${ORPHAN_WARNING}" >&2; echo api; echo db; echo web`), 'running|');
});

test('no db line is stopped, a warning that names a db container included', { skip }, () => {
  assert.equal(dbState(`echo "${ORPHAN_WARNING}" >&2; echo api`), 'stopped|');
  assert.equal(dbState('true'), 'stopped|');
  assert.equal(dbState('echo db-backup; echo mydb'), 'stopped|');
});

test('a ps that fails is unknown, with the last line compose printed', { skip }, () => {
  assert.equal(
    dbState(`echo "${ORPHAN_WARNING}" >&2; echo "Cannot connect to the Docker daemon" >&2; exit 1`),
    'unknown|Cannot connect to the Docker daemon',
  );
  assert.equal(dbState('exit 1'), 'unknown|no output');
});

test('deploy.sh stops on a ps it cannot read, and goes on only on a stopped database', () => {
  const deploy = readFileSync(join(REPO, 'infra/scripts/deploy.sh'), 'utf8');
  assert.match(deploy, /^source "\$SCRIPT_DIR\/lib\/db-running\.sh"$/mu);
  assert.match(
    deploy,
    /elif mc_db_state; \[\[ "\$MC_DB_STATE" == unknown \]\]; then\n\s*err "[^"\n]*\$MC_DB_PS_REASON"\n\s*exit 1\nelif \[\[ "\$MC_DB_STATE" == stopped \]\]; then\n\s*warn "Database not running/u,
  );
});

// A guard against repeating the old probe line, not a proof that the lib is the only reader.
test('no script repeats the old `ps --status running` probe', () => {
  const dir = join(REPO, 'infra/scripts');
  const readers = readdirSync(dir)
    .filter((name) => name.endsWith('.sh'))
    .filter((name) => /ps --status running/u.test(readFileSync(join(dir, name), 'utf8')));
  assert.deepEqual(readers, []);
});
