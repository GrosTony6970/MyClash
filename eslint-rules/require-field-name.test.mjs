/**
 * require-field-name: each way a field may be named passes, a placeholder alone fails, and the
 * rule is switched on wherever fields are written (the three apps and packages/ui). Runs under
 * `pnpm test:scripts`, like no-raw-api-fetch.test.mjs: no new CI step.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { RuleTester } from 'eslint';

import rule from './require-field-name.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

test('a field with a placeholder needs a name', () => {
  tester.run('require-field-name', rule, {
    valid: [
      { code: "const C = ({ t }) => <input placeholder={t('a.b')} aria-label={t('a.name')} />;" },
      {
        code: 'const C = ({ t }) => <textarea placeholder={t(\'a.b\')} aria-labelledby="note-title" />;',
      },
      {
        code: "const C = ({ t }) => <label>{t('a.name')}<input placeholder={t('a.b')} /></label>;",
      },
      {
        code: 'const C = ({ t }) => <><label htmlFor="club">{t(\'a\')}</label><select id="club" placeholder="x" /></>;',
      },
      {
        code: "const C = ({ t, id }) => <><label htmlFor={id}>{t('a')}</label><input id={id} placeholder={t('b')} /></>;",
      },
      { code: "const C = ({ t }) => <Input label={t('a')} placeholder={t('b')} />;" },
      { code: "const C = ({ t }) => <PromptDialog fieldLabel={t('a')} placeholder={t('b')} />;" },
      { code: 'const C = (props) => <input placeholder="x" {...props} />;' },
      { code: "const C = ({ t }) => <input aria-label={t('a')} />;" },
      { code: "const C = ({ t }) => <Other placeholder={t('a')} />;" },
    ],
    invalid: [
      {
        code: "const C = ({ t }) => <input placeholder={t('a.search')} />;",
        errors: [{ messageId: 'noName' }],
      },
      {
        code: "const C = ({ t }) => <textarea placeholder={t('a')} />;",
        errors: [{ messageId: 'noName' }],
      },
      {
        code: "const C = ({ t }) => <select placeholder={t('a')} />;",
        errors: [{ messageId: 'noName' }],
      },
      {
        code: "const C = ({ t }) => <Input placeholder={t('a')} />;",
        errors: [{ messageId: 'noName' }],
      },
      {
        code: "const C = ({ t }) => <PromptDialog placeholder={t('a')} />;",
        errors: [{ messageId: 'noName' }],
      },
      {
        // An id no htmlFor points at names nothing.
        code: 'const C = ({ t }) => <><label htmlFor="other">{t(\'a\')}</label><input id="club" placeholder={t(\'b\')} /></>;',
        errors: [{ messageId: 'noName' }],
      },
    ],
  });
});

test('the rule is switched on in the three apps and in packages/ui', () => {
  for (const dir of ['apps/web-admin', 'apps/web-public', 'apps/web-staff', 'packages/ui']) {
    const config = readFileSync(path.join(repoRoot, dir, 'eslint.config.mjs'), 'utf8');
    assert.match(config, /require-field-name\.mjs/, `${dir} imports the rule`);
    assert.match(config, /'myclash\/require-field-name': 'error'/, `${dir} turns it on`);
  }
});
