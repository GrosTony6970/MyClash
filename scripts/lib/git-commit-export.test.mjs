import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { gitCommitExportFinding } from './git-commit-export.mjs';

const script = (...lines) => lines.join('\n');
const EXPORT = 'export GIT_COMMIT="$NEW_COMMIT"';

test('a load before the export is fine', () => {
  assert.equal(gitCommitExportFinding(script('set -a', 'source ./.env', 'set +a', EXPORT)), null);
});

test('every way of loading .env after the export is found', () => {
  for (const load of [
    'source ./.env',
    '  source ./.env',
    '. ./.env',
    'source .env',
    'source "./.env"',
    "source './.env'",
    'source "$ROOT_DIR/.env"',
    'source "${ROOT_DIR}/.env"',
    'set -a; source ./.env; set +a',
    '[[ -f .env ]] && source ./.env',
    'if true; then source ./.env; fi',
  ]) {
    const finding = gitCommitExportFinding(script(EXPORT, 'echo hi', load));
    assert.match(finding ?? '', /line 3 loads \.env/, load);
  }
});

test('a function that loads .env counts where it is called, not where it is written', () => {
  const loader = ['load_env() {', '  set -a', '  source ./.env', '  set +a', '}'];
  assert.equal(gitCommitExportFinding(script(...loader, 'load_env', EXPORT)), null);
  assert.match(
    gitCommitExportFinding(script(...loader, EXPORT, 'load_env')) ?? '',
    /line 7 loads \.env/,
  );
});

test('a load after an indented function is still seen', () => {
  // rollback.sh's shape: a function inside an `if`, closed by an indented brace.
  const indented = ['if true; then', '  q() {', '    echo x', '  }', 'fi'];
  assert.match(
    gitCommitExportFinding(script(EXPORT, ...indented, 'source ./.env')) ?? '',
    /line 7 loads \.env/,
  );
});

test('another env file, or a comment, is not a load of .env', () => {
  for (const line of [
    'source ./.env.e2e',
    'source ./.env.example',
    '# source ./.env',
    'grep x .env',
  ]) {
    assert.equal(gitCommitExportFinding(script(EXPORT, line)), null, line);
  }
});

test('a script that never exports is a finding', () => {
  assert.match(gitCommitExportFinding(script('source ./.env')) ?? '', /never exports/);
});

test('the three deploy scripts hand Compose their commit', () => {
  for (const name of ['deploy', 'redeploy', 'rollback']) {
    const text = readFileSync(new URL(`../../infra/scripts/${name}.sh`, import.meta.url), 'utf8');
    assert.equal(gitCommitExportFinding(text), null, name);
  }
});
