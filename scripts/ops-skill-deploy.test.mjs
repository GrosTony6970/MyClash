/**
 * `deploy-check.mjs`: a `deploy` run's check after its round (ops agent slice 6, ruling 908). The
 * deploy announced a commit; the deploy record (`versions.deploy.deployedCommit`) and the API
 * container's own `GIT_COMMIT` (`versions.runningCommit`) must carry it. A redeploy that did not
 * name `api` leaves the API container alone (`--no-deps`), so its commit is not compared then.
 * The payload reaches the script through a file the run writes with its Write tool, never through
 * a shell command line: the shell would run a word like `services=x;cmd` before any check.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deployCommitLine } from '../.claude/skills/myclash-ops/deploy-check.mjs';

const SCRIPT = '.claude/skills/myclash-ops/deploy-check.mjs';
const NEW = '1111111111111111111111111111111111111111';
const OLD = '2222222222222222222222222222222222222222';
const LATER = '3333333333333333333333333333333333333333';

const versions = (deployedCommit, runningCommit) => ({
  deploy: { kind: 'deploy', deployedCommit },
  groups: [],
  runningCommit,
});
const DEPLOY = `deploy commit=${NEW} kind=deploy`;

describe('deployCommitLine', () => {
  it('ok when the record and the API both carry the announced commit', () => {
    assert.equal(deployCommitLine(versions(NEW, NEW), DEPLOY), 'commit ok');
    assert.equal(deployCommitLine(versions(NEW, NEW), `  ${DEPLOY}\n`), 'commit ok');
  });

  it('a mismatch when the API runs another commit after a deploy', () => {
    assert.equal(
      deployCommitLine(versions(NEW, OLD), DEPLOY),
      'commit mismatch announced=11111111 manifest=11111111 running=22222222',
    );
  });

  it('an unknown running commit is a mismatch when the API was rebuilt', () => {
    for (const running of ['unknown', undefined]) {
      assert.equal(
        deployCommitLine(versions(NEW, running), DEPLOY),
        'commit mismatch announced=11111111 manifest=11111111 running=unknown',
      );
    }
  });

  it('a redeploy that named api compares the API too', () => {
    const payload = `deploy commit=${NEW} kind=redeploy services=api,worker`;
    assert.equal(deployCommitLine(versions(NEW, NEW), payload), 'commit ok');
    assert.match(deployCommitLine(versions(NEW, OLD), payload), /^commit mismatch /u);
  });

  it('a redeploy of a web app alone does not compare the API', () => {
    const payload = `deploy commit=${NEW} kind=redeploy services=web-admin`;
    assert.equal(
      deployCommitLine(versions(NEW, OLD), payload),
      'commit ok (the API was not redeployed)',
    );
  });

  it('the API runs the announced commit while the record names another', () => {
    // A later web-only redeploy moved the record, or the record was not written (non-fatal).
    assert.equal(
      deployCommitLine(versions(LATER, NEW), DEPLOY),
      'commit ok, the deploy record names 33333333',
    );
    assert.equal(
      deployCommitLine(versions('unknown', NEW), DEPLOY),
      'commit ok, the deploy record names unknown',
    );
  });

  it('the record names another commit and the API does not run ours: changed', () => {
    assert.equal(deployCommitLine(versions(LATER, LATER), DEPLOY), 'commit changed 33333333');
    assert.equal(deployCommitLine(versions(LATER, OLD), DEPLOY), 'commit changed 33333333');
    const web = `deploy commit=${NEW} kind=redeploy services=web-admin`;
    assert.equal(deployCommitLine(versions(LATER, OLD), web), 'commit changed 33333333');
  });

  it('a record with no commit and an API on another commit is a mismatch', () => {
    assert.equal(
      deployCommitLine(versions('unknown', OLD), DEPLOY),
      'commit mismatch announced=11111111 manifest=unknown running=22222222',
    );
  });

  it('unread: no versions, no payload, a word of another shape, no 40-hex commit, no kind', () => {
    for (const [v, payload] of [
      [null, DEPLOY],
      [versions(NEW, NEW), null],
      [versions(NEW, NEW), ''],
      [versions(NEW, NEW), `alert commit=${NEW} kind=deploy`],
      [versions(NEW, NEW), `${DEPLOY} commit=$(x)`],
      [versions(NEW, NEW), `${DEPLOY} note=hi`],
      [versions(NEW, NEW), 'deploy commit=1111 kind=deploy'],
      [versions(NEW, NEW), 'deploy commit=unknown kind=deploy'],
      [versions(NEW, NEW), 'deploy kind=deploy'],
      [versions(NEW, NEW), `deploy commit=${NEW}`],
      [versions(NEW, NEW), `deploy commit=${NEW} kind=rollback`],
    ]) {
      assert.equal(deployCommitLine(v, payload), 'commit unread', String(payload));
    }
  });
});

describe('deploy-check.mjs', () => {
  const folder = (files) => {
    const dir = mkdtempSync(join(tmpdir(), 'deploy-check-'));
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
    return dir;
  };
  const run = (dir) => spawnSync('node', [SCRIPT, dir], { encoding: 'utf8' });

  it('reads payload.txt and versions.json, prints one line, exits 0 when ok', () => {
    const r = run(
      folder({ 'payload.txt': DEPLOY, 'versions.json': JSON.stringify(versions(NEW, NEW)) }),
    );
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, 'commit ok\n');
  });

  it('a note exits 0 too: the run must not read it as a failed command', () => {
    const r = run(
      folder({ 'payload.txt': DEPLOY, 'versions.json': JSON.stringify(versions(LATER, LATER)) }),
    );
    assert.equal(r.status, 0);
    assert.equal(r.stdout, 'commit changed 33333333\n');
  });

  it('exits 3 on a problem, and on a folder missing either file', () => {
    let r = run(folder({ 'payload.txt': DEPLOY }));
    assert.equal(r.status, 3);
    assert.equal(r.stdout, 'commit unread\n');
    r = run(folder({ 'versions.json': JSON.stringify(versions(NEW, NEW)) }));
    assert.equal(r.status, 3);
    assert.equal(r.stdout, 'commit unread\n');
    r = run(folder({ 'payload.txt': DEPLOY, 'versions.json': JSON.stringify(versions(NEW, OLD)) }));
    assert.equal(r.status, 3);
    assert.match(r.stdout, /^commit mismatch /u);
  });

  it('a usage error exits 2', () => {
    assert.equal(spawnSync('node', [SCRIPT], { encoding: 'utf8' }).status, 2);
  });

  // Slice 6 review M5: the skill's deploy check row, whole, so a line moved between the problem
  // and the note column goes red.
  it("the skill puts the check's lines in the right columns", () => {
    const skill = readFileSync('.claude/skills/myclash-ops/SKILL.md', 'utf8');
    const row = skill.split('\n').find((line) => line.startsWith('| The deploy check '));
    const cells = (row ?? '').split(' | ').map((cell) => cell.trim());
    assert.equal(cells.length, 3, row);
    assert.match(cells[1], /^`commit mismatch …`.*`commit unread`$/u);
    assert.doesNotMatch(cells[1], /commit changed|commit ok/u);
    assert.match(cells[2], /^`commit changed <commit>`:.*`commit ok, the deploy record names/u);
    assert.doesNotMatch(cells[2], /mismatch|unread/u);
  });

  it('reads files only: no network module, no dynamic import', () => {
    const text = readFileSync(SCRIPT, 'utf8');
    const imports = [...text.matchAll(/from '([^']+)'/gu)].map((m) => m[1]);
    assert.deepEqual(imports.sort(), ['node:fs', 'node:path', 'node:url']);
    assert.doesNotMatch(text, /\bimport\s*\(|\brequire\s*\(/u);
  });
});
