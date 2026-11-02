import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { deployMigrationFindings, readRunSummary } from './check-deploy-migrations.mjs';

const root = process.cwd();
const summary = (applied, skipped, total) =>
  `Applying 0001_a.sql... ok\nMigrations complete: ${applied} applied, ${skipped} skipped, ${total} total.\n`;

test('a run is read from the summary line migrate.mjs prints last', () => {
  assert.deepEqual(readRunSummary(summary(3, 0, 3)), { applied: 3, skipped: 0, total: 3 });
  assert.equal(readRunSummary('Applying 0001_a.sql... '), null);
});

test('every file applied, then every file skipped, is clean', () => {
  assert.deepEqual(deployMigrationFindings(summary(3, 0, 3), summary(0, 3, 3), 3), []);
});

test('a run that crashed before its summary is reported', () => {
  assert.deepEqual(deployMigrationFindings('Applying 0002_b.sql... ', summary(0, 3, 3), 3), [
    'The first run printed no "Migrations complete" line.',
  ]);
});

test('a file the image did not copy is reported on both runs', () => {
  assert.deepEqual(deployMigrationFindings(summary(2, 0, 2), summary(0, 2, 2), 3), [
    'The first run counted 2 migration files; the repo holds 3.',
    'The first run applied 2 and skipped 0; expected 3 applied and 0 skipped.',
    'The second run counted 2 migration files; the repo holds 3.',
    'The second run applied 0 and skipped 2; expected 0 applied and 3 skipped.',
  ]);
});

test('a first run that skipped files means the database was not fresh', () => {
  assert.deepEqual(deployMigrationFindings(summary(2, 1, 3), summary(0, 3, 3), 3), [
    'The first run applied 2 and skipped 1; expected 3 applied and 0 skipped.',
  ]);
});

test('a second run that applied again means the ledger lost a row', () => {
  assert.deepEqual(deployMigrationFindings(summary(3, 0, 3), summary(1, 2, 3), 3), [
    'The second run applied 1 and skipped 2; expected 0 applied and 3 skipped.',
  ]);
});

test("CI's job runs deploy.sh's and redeploy.sh's migrate command, from the prod compose file", () => {
  const command = 'run --rm api node packages/db/scripts/migrate.mjs';
  const deploy = readFileSync(join(root, 'infra', 'scripts', 'deploy.sh'), 'utf8');
  const ci = readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
  const start = ci.indexOf('\n  deploy-migrations:\n');
  assert.notEqual(start, -1, 'ci.yml has no deploy-migrations job');
  const rest = ci.slice(start + 1);
  const end = rest.slice(1).search(/^  [a-z][\w-]*:$/mu);
  const job = end === -1 ? rest : rest.slice(0, end + 1);

  const redeploy = readFileSync(join(root, 'infra', 'scripts', 'redeploy.sh'), 'utf8');
  for (const [name, text] of [
    ['deploy.sh', deploy],
    ['redeploy.sh', redeploy],
  ]) {
    assert.ok(text.includes(command), `${name} no longer runs "${command}"`);
    assert.ok(text.includes('-f infra/docker-compose.prod.yml)'), `${name}: another compose file`);
  }
  const prodCompose = 'docker compose --env-file .env.example -f infra/docker-compose.prod.yml';
  const composeCalls = job.split('docker compose').length - 1;
  assert.ok(composeCalls > 0, 'the job runs no docker compose');
  assert.equal(job.split(prodCompose).length - 1, composeCalls, 'every compose call: prod file');
  assert.equal(job.split(command).length - 1, 2, 'the job must run the command twice');
});
