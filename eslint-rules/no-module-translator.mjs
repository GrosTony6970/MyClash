/**
 * myclash/no-module-translator
 *
 * Bans `import { t } from '@myclash/i18n'` in the three apps.
 *
 * That `t` is `createTranslator(getMessages(defaultLocale))` — a module-init
 * singleton permanently bound to English. It renders English no matter what the
 * visitor chose, and nothing says so: the French string exists, the switcher
 * works, the page just never asks for it.
 *
 * It reached 73 client components and 991 render-position calls before anyone
 * noticed — whole pages (the clubs console, the event persons list) were English
 * for a French organiser. The fix there is `const { t } = useI18n()` from
 * @myclash/next-i18n/client; for a module-scope helper that cannot call a hook,
 * take the translator as a parameter (`t: Translator`).
 *
 * Until 2026-10-15 the rule read only `'use client'` modules, because the
 * directive is all it can prove. Four server `loading.tsx` screens then showed
 * "Loading" in English to every visitor for months. On the server the fix is
 * `await getServerT()` from @myclash/next-i18n/server, so the rule now reads
 * every module.
 *
 * `global-error.tsx` is exempt and always will be: it REPLACES the root layout,
 * so I18nProvider is not above it and useI18n() would read the context default
 * anyway. Escape any other deliberate case with a leading `// i18n-exempt`.
 */
const EXEMPT_FILENAMES = [/global-error\.tsx?$/];

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'disallow the English-bound module `t` in the apps',
    },
    messages: {
      moduleTranslator:
        '`t` from @myclash/i18n is bound to the default locale at module init, so this renders English whatever the visitor chose. In a client component use `const { t } = useI18n()` from @myclash/next-i18n/client; on the server use `await getServerT()` from @myclash/next-i18n/server; in a module-scope helper take `t: Translator` as a parameter.',
    },
    schema: [],
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    const filename = context.filename ?? context.getFilename();

    if (EXEMPT_FILENAMES.some((pattern) => pattern.test(filename))) return {};

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
