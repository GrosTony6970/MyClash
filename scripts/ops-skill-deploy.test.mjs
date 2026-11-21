/**
 * `deploy-check.mjs`: a `deploy` run's check after its round (ops agent slice 6, ruling 908). The
 * deploy announced a commit; the deploy record (`versions.deploy.deployedCommit`, written BEFORE
 * the build) and the API container's own `GIT_COMMIT` (`versions.runningCommit`) must carry it.
 * A redeploy that did not name `api` leaves the API container alone (`--no-deps`), so its commit
 * is not compared then. The payload words reach a shell command: only three shapes may pass.
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
const deployWords = [`commit=${NEW}`, 'kind=deploy'];

describe('deployCommitLine', () => {
  it('ok when the record and the API both carry the announced commit', () => {
    assert.equal(deployCommitLine(versions(NEW, NEW), deployWords), 'commit ok');
  });

  it('a mismatch when the API runs another commit after a deploy', () => {
    assert.equal(
      deployCommitLine(versions(NEW, OLD), deployWords),
      'commit mismatch announced=11111111 manifest=11111111 running=22222222',
    );
  });

  it('an unknown running commit is a mismatch when the API was rebuilt', () => {
    assert.equal(
      deployCommitLine(versions(NEW, 'unknown'), deployWords),
      'commit mismatch announced=11111111 manifest=11111111 running=unknown',
    );
    assert.equal(
      deployCommitLine(versions(NEW, undefined), deployWords),
      'commit mismatch announced=11111111 manifest=11111111 running=unknown',
    );
  });

  it('a redeploy that named api compares the API too', () => {
    const words = [`commit=${NEW}`, 'kind=redeploy', 'services=api,worker'];
    assert.equal(deployCommitLine(versions(NEW, NEW), words), 'commit ok');
    assert.match(deployCommitLine(versions(NEW, OLD), words), /^commit mismatch /u);
  });

  it('a redeploy of a web app alone does not compare the API', () => {
    const words = [`commit=${NEW}`, 'kind=redeploy', 'services=web-admin'];
    assert.equal(
      deployCommitLine(versions(NEW, OLD), words),
      'commit ok (the API was not redeployed)',
    );
  });

  it('a record that names another commit: a later deploy or a rollback ran', () => {
    assert.equal(deployCommitLine(versions(LATER, LATER), deployWords), 'commit changed 33333333');
    assert.equal(deployCommitLine(versions(LATER, OLD), deployWords), 'commit changed 33333333');
  });

  it('a record with no commit is a mismatch', () => {
    assert.equal(
      deployCommitLine(versions('unknown', NEW), deployWords),
      'commit mismatch announced=11111111 manifest=unknown running=11111111',
    );
  });

  it('unread: no versions, a word of another shape, no 40-hex commit, no known kind', () => {
    for (const [v, words] of [
      [null, deployWords],
      [versions(NEW, NEW), [`commit=${NEW}`, 'kind=deploy', 'commit=$(x)']],
      [versions(NEW, NEW), [`commit=${NEW}`, 'kind=deploy', 'note=hi']],
      [versions(NEW, NEW), ['commit=1111', 'kind=deploy']],
      [versions(NEW, NEW), ['commit=unknown', 'kind=deploy']],
      [versions(NEW, NEW), ['kind=deploy']],
      [versions(NEW, NEW), [`commit=${NEW}`]],
      [versions(NEW, NEW), [`commit=${NEW}`, 'kind=rollback']],
    ]) {
      assert.equal(deployCommitLine(v, words), 'commit unread', JSON.stringify(words));
    }
  });
});

describe('deploy-check.mjs', () => {
  const run = (dir, ...words) => spawnSync('node', [SCRIPT, dir, ...words], { encoding: 'utf8' });

  it('reads the round folder, prints one line, exits 0 when ok', () => {
    const dir = mkdtempSync(join(tmpdir(), 'deploy-check-'));
    writeFileSync(join(dir, 'versions.json'), JSON.stringify(versions(NEW, NEW)));
    const r = run(dir, ...deployWords);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, 'commit ok\n');
  });

  it('exits 3 on a problem, and on a folder with no versions.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'deploy-check-'));
    let r = run(dir, ...deployWords);
    assert.equal(r.status, 3);
    assert.equal(r.stdout, 'commit unread\n');
    writeFileSync(join(dir, 'versions.json'), JSON.stringify(versions(NEW, OLD)));
    r = run(dir, ...deployWords);
    assert.equal(r.status, 3);
    assert.match(r.stdout, /^commit mismatch /u);
  });

  it('a usage error exits 2', () => {
    assert.equal(spawnSync('node', [SCRIPT], { encoding: 'utf8' }).status, 2);
  });

  it('reads files only: no network module', () => {
    const imports = [...readFileSync(SCRIPT, 'utf8').matchAll(/from '([^']+)'/gu)].map((m) => m[1]);
    assert.deepEqual(imports.sort(), ['node:fs', 'node:path', 'node:url']);
  });
});
