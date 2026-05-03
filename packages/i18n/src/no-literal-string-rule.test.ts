import { RuleTester } from 'eslint';

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    parserOptions: {
      ecmaFeatures: { jsx: true },
      sourceType: 'module',
    },
  },
});

(async () => {
  const ruleModulePath = '../../../eslint-rules/no-literal-string.mjs';
  const { default: rule } = (await import(ruleModulePath)) as { default: never };

  tester.run('no-literal-string', rule, {
    valid: [
      {
        code: "const Component = ({ t }) => <button aria-label={t('actions.save')}>{t('actions.save')}</button>;",
      },
      {
        code: "const route = '/api/v1/events'; const className = 'text-sm font-bold';",
      },
      {
        code: 'const Component = () => <code>HTTP 409</code>;',
      },
    ],
    invalid: [
      {
        code: 'const Component = () => <button>Save changes</button>;',
        errors: [{ messageId: 'literalText' }],
      },
      {
        code: 'const Component = () => <input placeholder="Search events" />;',
        errors: [{ messageId: 'literalProp' }],
      },
    ],
  });
})();
