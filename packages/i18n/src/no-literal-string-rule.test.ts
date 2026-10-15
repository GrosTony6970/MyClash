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
      // X4: a class name in a ternary, a value, or a translated word is not text to move.
      {
        code: "const C = ({ on }) => <div className={on ? 'font-bold text-sm' : 'text-xs'} />;",
      },
      { code: 'const C = ({ count }) => <p>{count}</p>;' },
      { code: "const C = ({ t, on }) => <p>{on ? t('a.yes') : t('a.no')}</p>;" },
      { code: "const C = ({ t }) => <Header eyebrow={t('admin.clubs')} subtitle={t('x.y')} />;" },
      { code: "confirm({ title: t('a.b'), confirmLabel: t('actions.delete') });" },
      { code: "const C = () => <code>{'GET /api/v1/x'}</code>;" },
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
      // X4: the props of the page header and of the dialogs.
      {
        code: 'const C = () => <Header eyebrow="Clubs" subtitle="Manage the clubs." />;',
        errors: [{ messageId: 'literalProp' }, { messageId: 'literalProp' }],
      },
      {
        code: 'const C = () => <Dialog description="Gone for good." confirmLabel="Delete" cancelLabel="Keep" />;',
        errors: [
          { messageId: 'literalProp' },
          { messageId: 'literalProp' },
          { messageId: 'literalProp' },
        ],
      },
      // X4: the strings inside `{…}` of a watched prop: both branches, a fallback, a template.
      {
        code: "const C = ({ on }) => <button title={on ? 'Collapse' : 'Expand'} />;",
        errors: [{ messageId: 'literalProp' }, { messageId: 'literalProp' }],
      },
      {
        code: "const C = ({ label }) => <Swatch aria-label={label ?? 'Color'} />;",
        errors: [{ messageId: 'literalProp' }],
      },
      {
        code: 'const C = ({ v }) => <Field placeholder={`Default: ${v}`} />;',
        errors: [{ messageId: 'literalProp' }],
      },
      // X4: the strings inside `{…}` of JSX children.
      {
        code: "const C = ({ on }) => <span>{on ? 'Yes' : 'No'}</span>;",
        errors: [{ messageId: 'literalText' }, { messageId: 'literalText' }],
      },
      {
        code: "const C = ({ name }) => <span>{name || '(unnamed)'}</span>;",
        errors: [{ messageId: 'literalText' }],
      },
      {
        code: "const C = ({ busy }) => <span>{busy && 'Saving…'}</span>;",
        errors: [{ messageId: 'literalText' }],
      },
      {
        code: 'const C = ({ n }) => <span>{`${n} characters required`}</span>;',
        errors: [{ messageId: 'literalText' }],
      },
      {
        code: "const C = () => <><b>{'Loading…'}</b></>;",
        errors: [{ messageId: 'literalText' }],
      },
      // X4: every word of a confirm() or prompt() question, not only its title.
      {
        code: "confirm({ title: t('a.b'), description: 'This cannot be undone.', confirmLabel: 'Delete' });",
        errors: [{ messageId: 'literalCall' }, { messageId: 'literalCall' }],
      },
      {
        code: "prompt({ title: 'Why reject it?', cancelLabel: t('actions.cancel') });",
        errors: [{ messageId: 'literalCall' }],
      },
    ],
  });
})();
