/**
 * myclash/no-literal-locale
 *
 * Bans hardcoded locale strings in date/number formatting so display always
 * follows the visitor's chosen locale instead of a baked-in 'fr-FR'/'en-GB'.
 * Flags:
 *   x.toLocaleDateString('fr-FR', …)   (also toLocaleTimeString / toLocaleString)
 *   new Intl.DateTimeFormat('fr-FR', …)
 *   formatInZone(iso, tz, opts, 'fr-FR')   (4th arg — from @myclash/time)
 *
 * The fix is always the same: thread the active UI locale and map it with
 * `localeToBcp47(locale)` from @myclash/time (locale from useI18n() in client
 * components, resolveServerLocale() on the server). Escape a deliberate literal
 * with a leading `// locale-exempt` (or `// i18n-exempt`) comment.
 */

const localeMethods = new Set([
  'toLocaleDateString',
  'toLocaleTimeString',
  'toLocaleString',
]);

// A BCP-47-ish tag: primary subtag + optional region (e.g. fr, en, fr-FR, en-GB).
const LOCALE_LITERAL = /^[a-z]{2}(?:-[A-Za-z]{2,4})?$/u;

function hasEscapeComment(sourceCode, node) {
  return sourceCode
    .getCommentsBefore(node)
    .some((comment) => /i18n-exempt|myclash-i18n-exempt|locale-exempt/.test(comment.value));
}

function isLocaleLiteral(arg) {
  return (
    arg &&
    arg.type === 'Literal' &&
    typeof arg.value === 'string' &&
    LOCALE_LITERAL.test(arg.value)
  );
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'disallow hardcoded locale strings in date/number formatting',
    },
    messages: {
      literalLocale:
        "Don't hardcode a locale. Thread the active UI locale via localeToBcp47(locale) from @myclash/time (locale from useI18n() or resolveServerLocale()).",
    },
    schema: [],
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();

    function reportIfLocale(arg) {
      if (isLocaleLiteral(arg) && !hasEscapeComment(sourceCode, arg)) {
        context.report({ node: arg, messageId: 'literalLocale' });
      }
    }

    return {
      // x.toLocale*(‹locale›, …)
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type === 'MemberExpression' &&
          !callee.computed &&
          callee.property.type === 'Identifier' &&
          localeMethods.has(callee.property.name)
        ) {
          reportIfLocale(node.arguments[0]);
          return;
        }
        // formatInZone(iso, tz, opts, ‹locale›)
        if (callee.type === 'Identifier' && callee.name === 'formatInZone') {
          reportIfLocale(node.arguments[3]);
        }
      },
      // new Intl.DateTimeFormat(‹locale›, …)
      NewExpression(node) {
        const callee = node.callee;
        if (
          callee.type === 'MemberExpression' &&
          !callee.computed &&
          callee.object.type === 'Identifier' &&
          callee.object.name === 'Intl' &&
          callee.property.type === 'Identifier' &&
          callee.property.name === 'DateTimeFormat'
        ) {
          reportIfLocale(node.arguments[0]);
        }
      },
    };
  },
};
