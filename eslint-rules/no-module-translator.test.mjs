/**
 * no-module-translator: the English-bound `t` is refused in client AND server modules of the
 * three apps, `global-error` and a marked exemption pass, and the rule is switched on in each
 * app. Runs under `pnpm test:scripts`, like its siblings: no new CI step.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { RuleTester } from 'eslint';

import rule from './no-module-translator.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

test('the English-bound t is refused on the client and on the server', () => {
  tester.run('no-module-translator', rule, {
    valid: [
      { code: "import { getMessages } from '@myclash/i18n';" },
      { code: "import { t } from 'elsewhere';" },
      {
        code: "'use client';\nimport { t } from '@myclash/i18n';",
        filename: 'app/global-error.tsx',
      },
      { code: "// i18n-exempt: a test fixture\nimport { t } from '@myclash/i18n';" },
    ],
    invalid: [
      {
        code: "'use client';\nimport { t } from '@myclash/i18n';",
        errors: [{ messageId: 'moduleTranslator' }],
      },
      {
        // A server loading screen: the case the client-only rule let through.
        code: "import { t } from '@myclash/i18n';",
        filename: 'app/me/loading.tsx',
        errors: [{ messageId: 'moduleTranslator' }],
      },
    ],
  });
});

test('the rule is switched on in each of the three apps', () => {
  for (const app of ['web-admin', 'web-public', 'web-staff']) {
    const config = readFileSync(path.join(repoRoot, 'apps', app, 'eslint.config.mjs'), 'utf8');
    assert.match(config, /'myclash\/no-module-translator': 'error'/, app);
  }
});
