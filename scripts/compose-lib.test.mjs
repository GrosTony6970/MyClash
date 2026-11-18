/**
 * infra/scripts/lib/compose.sh: the one way an ops script builds its `docker compose` command.
 *
 * The certificate mode lives in the VPS `.env` (`TLS_CERTS=staging|production`), not in a flag a
 * person must repeat. On 2026-11-18 a `redeploy.sh api worker --no-build` without `--dev-certs`
 * recreated the API without the staging-certs overlay: it stopped trusting the staging
 * certificate of the host it reads the database through, and every database read failed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = join(REPO, 'infra/scripts');
const LIB = join(SCRIPTS, 'lib/compose.sh').replaceAll('\\', '/');
const LOG = join(SCRIPTS, 'lib/log.sh').replaceAll('\\', '/');
// Git Bash on Windows: System32's bash.exe is WSL, which cannot read a Windows PATH.
const BASH = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const skip = process.platform === 'win32' && !existsSync(BASH) ? 'needs Git Bash' : false;

const STAGING_CA = 'https://acme-staging-v02.api.letsencrypt.org/directory';

/** A root dir whose `.env` holds `envText` (or no `.env` when null). */
function rootWith(envText) {
  const dir = mkdtempSync(join(tmpdir(), 'compose-lib-'));
  if (envText !== null) writeFileSync(join(dir, '.env'), envText);
  return dir;
}

/**
 * Sources the lib under the scripts' own shell options, runs `calls`, and prints the COMPOSE
 * array, the mode and the two ACME exports, one per line.
 */
function run(root, calls, { devCerts = false } = {}) {
  const script = [
    'set -Eeuo pipefail',
    `source "${LOG}"`,
    'source "$0"',
    `ROOT_DIR="${root.replaceAll('\\', '/')}"`,
    `USE_DEV_CERTS=${devCerts ? 1 : 0}`,
    ...calls,
    'printf "%s\\n" "${COMPOSE[*]}" "$MC_TLS_CERTS" "${ACME_CA_SERVER:-}" "${ACME_STORAGE_FILE:-}"',
  ].join('\n');
  const out = spawnSync(BASH, ['-c', script, LIB], {
    env: { ...process.env, ACME_CA_SERVER: '', ACME_STORAGE_FILE: '' },
    encoding: 'utf8',
  });
  // log.sh's ok/warn print to stdout, so the four values are the LAST four lines.
  const lines = out.stdout.replace(/\n$/u, '').split('\n');
  const [compose = '', mode = '', ca = '', storage = ''] = lines.slice(-4);
  const said = `${out.stdout}${out.stderr}`;
  return { status: out.status, stderr: said, compose, mode, ca, storage };
}

test('staging in .env adds the overlay and the staging CA', { skip }, () => {
  const r = run(rootWith('DOMAIN=example.test\nTLS_CERTS=staging\n'), ['mc_compose_init']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(
    r.compose,
    /-f infra\/docker-compose\.prod\.yml -f infra\/docker-compose\.staging-certs\.yml$/,
  );
  assert.equal(r.mode, 'staging');
  assert.equal(r.ca, STAGING_CA);
  assert.equal(r.storage, 'acme-staging.json');
});

test('production in .env is the plain compose file and the default CA', { skip }, () => {
  const r = run(rootWith('TLS_CERTS=production\n'), ['mc_compose_init', 'mc_require_cert_mode']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.compose, /-f infra\/docker-compose\.prod\.yml$/);
  assert.equal(r.mode, 'production');
  assert.equal(r.ca, '');
  assert.equal(r.storage, '');
});

test('a quoted value with a Windows line ending still reads', { skip }, () => {
  const r = run(rootWith('TLS_CERTS="staging"\r\n'), ['mc_compose_init']);
  assert.equal(r.mode, 'staging');
});

test('a script that creates containers refuses a missing or unknown mode', { skip }, () => {
  for (const env of ['DOMAIN=example.test\n', 'TLS_CERTS=\n', 'TLS_CERTS=stagign\n', null]) {
    const r = run(rootWith(env), ['mc_compose_init', 'mc_require_cert_mode']);
    assert.notEqual(r.status, 0, `accepted ${JSON.stringify(env)}`);
    assert.match(r.stderr, /TLS_CERTS=staging/);
  }
});

test(
  'a script that only reads goes on without a mode, on the plain file, and says so',
  { skip },
  () => {
    const r = run(rootWith('DOMAIN=example.test\n'), ['mc_compose_init']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.compose, /-f infra\/docker-compose\.prod\.yml$/);
    assert.equal(r.mode, '');
    assert.match(r.stderr, /TLS_CERTS/);
  },
);

test('--dev-certs with no mode yet writes staging into .env, once', { skip }, () => {
  const root = rootWith('DOMAIN=example.test\nTLS_CERTS=\nOTHER=kept\n');
  const r = run(root, ['mc_compose_init', 'mc_require_cert_mode'], { devCerts: true });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.mode, 'staging');
  assert.equal(
    readFileSync(join(root, '.env'), 'utf8'),
    'DOMAIN=example.test\nTLS_CERTS=staging\nOTHER=kept\n',
  );
  const appended = rootWith('DOMAIN=example.test\n');
  run(appended, ['mc_compose_init'], { devCerts: true });
  assert.equal(
    readFileSync(join(appended, '.env'), 'utf8'),
    'DOMAIN=example.test\nTLS_CERTS=staging\n',
  );
});

test('--dev-certs against a production .env is refused, not obeyed', { skip }, () => {
  const r = run(rootWith('TLS_CERTS=production\n'), ['mc_compose_init'], { devCerts: true });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /production/);
});

const SH = readdirSync(SCRIPTS).filter((name) => name.endsWith('.sh'));
const text = (name) => readFileSync(join(SCRIPTS, name), 'utf8');
const usesCompose = (name) => text(name).includes('"${COMPOSE[@]}"');
/** `up`, `run`, `build` and `create` make or remake a container from the compose files. */
const createsContainers = (name) =>
  /"\$\{COMPOSE\[@\]\}"[^|\n]*\b(up|run|build|create)\b/u.test(text(name));

test('no script builds its compose command itself', () => {
  assert.deepEqual(
    SH.filter((name) => /^\s*COMPOSE=\(/mu.test(text(name))),
    [],
  );
});

test('every script that runs compose builds it through the lib', () => {
  const missing = SH.filter(usesCompose).filter(
    (name) =>
      !/^source "\$SCRIPT_DIR\/lib\/compose\.sh"$/mu.test(text(name)) ||
      !/^mc_compose_init$/mu.test(text(name)),
  );
  assert.deepEqual(missing, []);
});

test('every script that creates containers requires the mode', () => {
  const creators = SH.filter(createsContainers);
  assert.deepEqual(creators.sort(), [
    'deploy.sh',
    'redeploy.sh',
    'restore.sh',
    'rollback.sh',
    'start.sh',
  ]);
  assert.deepEqual(
    creators.filter((name) => !/^mc_require_cert_mode$/mu.test(text(name))),
    [],
  );
});
