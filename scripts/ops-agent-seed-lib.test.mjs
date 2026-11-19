/**
 * infra/scripts/lib/ops-agent-seed.sh: the one way an ops script seeds the ops agent's key
 * (ruling 885). A restore or a rollback puts back a database whose key rows date from the backup:
 * a key revoked on the console since then is live again. So both scripts seed again after the
 * database is back, and `.env` decides which key stays live.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = join(REPO, 'infra/scripts');
const LIB = join(SCRIPTS, 'lib/ops-agent-seed.sh').replaceAll('\\', '/');
const LOG = join(SCRIPTS, 'lib/log.sh').replaceAll('\\', '/');
// Git Bash on Windows: System32's bash.exe is WSL, which cannot read a Windows PATH.
const BASH = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const skip = process.platform === 'win32' && !existsSync(BASH) ? 'needs Git Bash' : false;

const AFTER_RESTORE =
  'agent: a key revoked on the console after this backup was taken is live again if ' +
  'OPS_AGENT_KEY still holds it. To turn the agent off for good, empty OPS_AGENT_KEY in .env ' +
  'and run deploy.sh.';

const read = (name) => readFileSync(join(SCRIPTS, name), 'utf8');
const lineOf = (text, needle, from = 0) => {
  const lines = text.split('\n');
  for (let i = from; i < lines.length; i += 1) if (lines[i].includes(needle)) return i;
  return -1;
};

/**
 * The line of the nearest `if` that opens a block around `line`, or -1: walks up, counting
 * `fi` against `if … then`.
 */
function enclosingIf(text, line) {
  const lines = text.split('\n');
  let depth = 0;
  for (let i = line - 1; i >= 0; i -= 1) {
    const t = lines[i].trim();
    if (t === 'fi') depth += 1;
    else if (/^if .*; then$/u.test(t)) {
      if (depth === 0) return i;
      depth -= 1;
    }
  }
  return -1;
}

test('deploy, restore and rollback seed through the lib, never the seed script itself', () => {
  for (const script of ['deploy.sh', 'restore.sh', 'rollback.sh']) {
    const text = read(script);
    assert.match(text, /source "\$SCRIPT_DIR\/lib\/ops-agent-seed\.sh"/u, script);
    assert.match(text, /^\s*mc_(seed_ops_agent|reseed_ops_agent_after_restore)$/mu, script);
    assert.doesNotMatch(text, /bootstrap-ops-agent\.mjs/u, script);
  }
});

test('restore seeds again after the restart, only when it restored the database', () => {
  const text = read('restore.sh');
  const restarted = lineOf(text, 'ok "Restarted"');
  const call = lineOf(text, 'mc_reseed_ops_agent_after_restore', restarted);
  assert.ok(restarted > 0 && call > restarted, 'the call comes after ok "Restarted"');
  const opener = enclosingIf(text, call);
  assert.ok(opener > restarted, 'the call sits in its own branch after the restart');
  assert.equal(text.split('\n')[opener].trim(), 'if [[ "$STORAGE_ONLY" -eq 0 ]]; then');
});

test('rollback sources the lib before its git reset and seeds after a database restore', () => {
  const text = read('rollback.sh');
  const source = lineOf(text, 'source "$SCRIPT_DIR/lib/ops-agent-seed.sh"');
  const reset = lineOf(text, 'git reset --hard "$PREV_COMMIT"');
  assert.ok(source >= 0 && reset > source, 'the lib is read before the tree is reset');
  const started = lineOf(text, 'ok "Stack started"');
  const call = lineOf(text, 'mc_reseed_ops_agent_after_restore', started);
  assert.ok(started > 0 && call > started, 'the call comes after ok "Stack started"');
  const opener = enclosingIf(text, call);
  assert.ok(opener > started, 'the call sits in its own branch after the start');
  assert.equal(
    text.split('\n')[opener].trim(),
    'if [[ "$BACKUP_FILE" != "none" && -f "$BACKUP_FILE" ]]; then',
  );
});

/** Sources log.sh and the lib under the scripts' own options, with COMPOSE a stub. */
function runLib(calls, { password, seedOutput }) {
  const script = [
    'set -Eeuo pipefail',
    `source "${LOG}"`,
    'source "$0"',
    `fake_compose() { printf '%s\\n' '${seedOutput}'; }`,
    'COMPOSE=(fake_compose)',
    ...calls,
    'echo "exit-ok"',
  ].join('\n');
  const env = { ...process.env, DOMAIN: 'example.test', OPS_AGENT_KEY: '' };
  delete env.POSTGRES_PASSWORD;
  if (password) env.POSTGRES_PASSWORD = password;
  const out = spawnSync(BASH, ['-c', script, LIB], { env, encoding: 'utf8' });
  return { status: out.status, said: `${out.stdout}${out.stderr}` };
}

test('a missing database password warns and never ends the script that called it', { skip }, () => {
  const r = runLib(['mc_seed_ops_agent'], { password: null, seedOutput: '{"state":"existing"}' });
  assert.equal(r.status, 0, r.said);
  assert.match(r.said, /exit-ok/u, r.said);
  assert.match(r.said, /agent: the key seed reported an issue/u, r.said);
});

test('the seed reports the state it read', { skip }, () => {
  const r = runLib(['mc_seed_ops_agent'], { password: 'pw', seedOutput: '{"state":"existing"}' });
  assert.equal(r.status, 0, r.said);
  assert.match(r.said, /agent: key active/u, r.said);
});

test('after a restore the script says that a console revoke does not survive it', { skip }, () => {
  const r = runLib(['mc_reseed_ops_agent_after_restore'], {
    password: 'pw',
    seedOutput: '{"state":"existing"}',
  });
  assert.equal(r.status, 0, r.said);
  assert.ok(r.said.includes(AFTER_RESTORE), r.said);
  assert.doesNotMatch(r.said, /login service/u, r.said);
});

test('a failed seed after a restore names the login service and the next deploy', { skip }, () => {
  const r = runLib(['mc_reseed_ops_agent_after_restore'], {
    password: 'pw',
    seedOutput: '{"state":"failed","error":"GoTrue 503"}',
  });
  assert.equal(r.status, 0, r.said);
  assert.match(r.said, /login service may still be starting/u, r.said);
  assert.match(r.said, /next deploy\.sh seeds the key again/u, r.said);
});
