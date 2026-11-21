/**
 * Ruling 941 (ops agent slice 6, from the final review): the deploy record's time is when the
 * deploy ended. deploy.sh writes the manifest (`data/system-versions.json`) before it builds, so
 * that a failed build still names its attempt; with only that write, "15 minutes after a deploy"
 * (ruling 887) counted from the start, and a 20-minute build left no hold at all. So deploy.sh
 * writes it again once the stack is healthy, with the same time as `.last-deploy.json`, and
 * before the ops agent's deploy check starts (that run reads it).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lines = readFileSync(join(REPO, 'infra/scripts/deploy.sh'), 'utf8').split('\n');
const at = (re) => lines.findIndex((l) => re.test(l));
const all = (re) => lines.flatMap((l, i) => (re.test(l) ? [i] : []));

test('deploy.sh writes the deploy record before the build and again at its end', () => {
  const writes = all(/^mc_write_system_versions_manifest \\$/u);
  const build = at(/^hdr "Building images"$/u);
  const healthy = at(/^mc_verify_edge_plugins \|\| true$/u);
  const wake = at(/^mc_wake_ops_agent_after_deploy deploy /u);
  assert.equal(writes.length, 2, 'two writes');
  assert.ok(writes[0] < build, 'the first before the build');
  assert.ok(writes[1] > healthy, 'the second once the stack is healthy');
  assert.ok(writes[1] < wake, 'before the deploy check starts');
});

test('the end write carries the time .last-deploy.json carries, and never fails the deploy', () => {
  const second = all(/^mc_write_system_versions_manifest \\$/u)[1];
  const call = lines.slice(second, second + 8).join('\n');
  assert.match(call, /^ {2}deploy \\$/mu);
  assert.match(call, /^ {2}"\$DEPLOYED_AT" \\$/mu);
  assert.match(call, /\|\|\n {2}warn /u);
  assert.ok(at(/^DEPLOYED_AT="\$\(mc_now_utc\)"$/u) >= 0, 'one time, taken once');
  assert.ok(at(/^ {2}"deployedAt": "\$DEPLOYED_AT",$/u) >= 0, '.last-deploy.json says the same');
});
