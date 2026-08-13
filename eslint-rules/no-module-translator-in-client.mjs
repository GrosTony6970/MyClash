/**
 * myclash/no-module-translator-in-client
 *
 * Bans `import { t } from '@myclash/i18n'` in a `'use client'` module.
 *
 * That `t` is `createTranslator(getMessages(defaultLocale))` — a module-init
 * singleton permanently bound to English. In a client component it renders
 * English no matter what the visitor chose, and nothing says so: the French
 * string exists, the switcher works, the page just never asks for it.
 *
 * It reached 73 client components and 991 render-position calls before anyone
 * noticed — whole pages (the clubs console, the event persons list) were English
 * for a French organiser. The fix is `const { t } = useI18n()` from
 * @myclash/next-i18n/client; for a module-scope helper that cannot call a hook,
 * take the translator as a parameter (`t: Translator`).
 *
 * Server components are untouched: there `t` is still wrong for a different
 * reason (use `getServerT()`), but this rule only claims what it can prove from
 * the directive.
 *
 * `global-error.tsx` is exempt and always will be: it REPLACES the root layout,
 * so I18nProvider is not above it and useI18n() would read the context default
 * anyway. Escape any other deliberate case with a leading `// i18n-exempt`.
 */
const EXEMPT_FILENAMES = [/global-error\.tsx?$/];

function isClientModule(sourceCode) {
  for (const statement of sourceCode.ast.body) {
    if (statement.type !== 'ExpressionStatement') break;
    const value = statement.directive ?? statement.expression?.value;
    if (typeof value !== 'string') break;
    if (value === 'use client') return true;
  }
  return false;
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: "disallow the English-bound module `t` in 'use client' modules",
    },
    messages: {
      moduleTranslator:
        '`t` from @myclash/i18n is bound to the default locale at module init, so this renders English whatever the visitor chose. Use `const { t } = useI18n()` from @myclash/next-i18n/client, or take `t: Translator` as a parameter in a module-scope helper.',
    },
    schema: [],
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    const filename = context.filename ?? context.getFilename();

    if (EXEMPT_FILENAMES.some((pattern) => pattern.test(filename))) return {};
    if (!isClientModule(sourceCode)) return {};

    return {
      ImportDeclaration(node) {
        if (node.source.value !== '@myclash/i18n') return;
        for (const specifier of node.specifiers) {
          if (
            specifier.type === 'ImportSpecifier' &&
            specifier.imported.name === 't' &&
            specifier.importKind !== 'type'
          ) {
            const exempt = sourceCode
              .getCommentsBefore(node)
              .some((comment) => /i18n-exempt/.test(comment.value));
            if (!exempt) context.report({ node: specifier, messageId: 'moduleTranslator' });
          }
        }
      },
    };
  },
};
