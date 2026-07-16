/**
 * myclash/no-server-api-url-leak
 *
 * Keeps the docker-internal API host out of the browser.
 *
 * `getServerApiUrl()` returns `API_URL_INTERNAL` (`http://api:4000` in prod).
 * The browser can't resolve that host, and plain `http://` is additionally
 * blocked as mixed content on an HTTPS page — so a fetch against it rejects and
 * the UI dies silently (or shows a generic "could not load" error, which is how
 * this last surfaced on /me). Flags the two ways the value crosses over:
 *
 *   1. a 'use client' file importing it at all — client modules run in the
 *      browser, where the internal host is meaningless
 *   2. it reaching JSX from a server component — a prop on a client component,
 *      or an href/src that lands in the rendered HTML
 *
 * Both are single-file syntactic facts, which is the whole reason
 * `getApiUrl()` was split into `getServerApiUrl()` / `getPublicApiUrl()`: the
 * old single helper branched on `typeof window`, making "is this value safe
 * here?" a cross-module dataflow question that ESLint cannot answer.
 *
 * Does NOT flag a server component's own server-side use, which is the point of
 * the helper:
 *   const apiUrl = getServerApiUrl();
 *   await fetch(`${apiUrl}/api/v1/events`);
 * ...nor a prop handed to another SERVER component — a real pattern here, see
 * app/e/[eventSlug]/home/page.tsx → CompetitorHome.
 *
 * Fixes:
 *   - anything the browser touches → `getPublicApiUrl()` from '@/lib/api-url'
 *   - a client component needing the URL → let it call `getPublicApiUrl()`
 *     itself rather than receiving it as a prop
 *
 * Escape a deliberate case with a leading `// api-url-exempt` comment.
 */

const DEFAULT_FUNCTIONS = ['getServerApiUrl'];
// Suffix-matched against the import source, so '@/lib/api-url',
// '../../src/lib/api-url' and './api-url' all resolve to the same helper.
const DEFAULT_MODULES = ['lib/api-url'];

/** `'use client'` in the directive prologue. A leading JSDoc block is a comment,
 * not a body node, so it doesn't interfere. */
function hasUseClientDirective(programNode) {
  for (const statement of programNode.body) {
    if (statement.type !== 'ExpressionStatement') return false;
    const expression = statement.expression;
    if (expression.type !== 'Literal' || typeof expression.value !== 'string') return false;
    if (expression.value === 'use client') return true;
  }
  return false;
}

function hasEscapeComment(sourceCode, node) {
  return sourceCode
    .getCommentsBefore(node)
    .some((comment) => /api-url-exempt|ssr-exempt/u.test(comment.value));
}

/** Climb from a node to the JSX construct consuming it, if any. */
function isInsideJsx(node) {
  let parent = node.parent;
  while (parent) {
    if (parent.type === 'JSXExpressionContainer' || parent.type === 'JSXSpreadAttribute') {
      return true;
    }
    // Don't climb out of the enclosing function — a call in a nested callback
    // (e.g. an event handler) isn't rendered, it runs in the browser.
    if (
      parent.type === 'FunctionDeclaration' ||
      parent.type === 'FunctionExpression' ||
      parent.type === 'ArrowFunctionExpression'
    ) {
      return false;
    }
    parent = parent.parent;
  }
  return false;
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'disallow leaking the server-only API URL (docker-internal host) into the browser',
    },
    messages: {
      clientImport:
        "'{{name}}' returns the docker-internal API host (http://api:4000), which the browser can't resolve and blocks as mixed content on HTTPS. This is a client module — use getPublicApiUrl() from '@/lib/api-url' instead.",
      jsxLeak:
        "'{{name}}' returns the docker-internal API host (http://api:4000). Rendering it into JSX ships that host to the browser, where it can't resolve and is blocked as mixed content on HTTPS. For a client component, drop the prop and let it call getPublicApiUrl() itself; for a URL in the HTML, use getPublicApiUrl().",
    },
    schema: [
      {
        type: 'object',
        properties: {
          functions: { type: 'array', items: { type: 'string' } },
          modules: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    const options = context.options[0] ?? {};
    const functions = new Set(options.functions ?? DEFAULT_FUNCTIONS);
    const modules = options.modules ?? DEFAULT_MODULES;

    /** Local names bound to the tracked helper (survives `import { x as y }`). */
    const trackedLocals = new Set();
    let isClientFile = false;

    const isTrackedModule = (source) =>
      modules.some((m) => source === m || source.endsWith(`/${m}`));

    return {
      Program(node) {
        isClientFile = hasUseClientDirective(node);
        for (const statement of node.body) {
          if (statement.type !== 'ImportDeclaration') continue;
          if (!isTrackedModule(statement.source.value)) continue;
          for (const specifier of statement.specifiers) {
            if (
              specifier.type !== 'ImportSpecifier' ||
              specifier.imported.type !== 'Identifier' ||
              !functions.has(specifier.imported.name)
            ) {
              continue;
            }
            trackedLocals.add(specifier.local.name);
            // (1) a client module must not import the server-only helper at all.
            if (isClientFile && !hasEscapeComment(sourceCode, statement)) {
              context.report({
                node: specifier,
                messageId: 'clientImport',
                data: { name: specifier.imported.name },
              });
            }
          }
        }
      },

      // (2) the value reaching JSX from a server file — either inline
      // (<Foo apiUrl={getServerApiUrl()} />) or via an identifier bound to it.
      CallExpression(node) {
        if (isClientFile) return; // already reported at the import
        if (node.callee.type !== 'Identifier' || !trackedLocals.has(node.callee.name)) return;
        if (!isInsideJsx(node)) return;
        if (hasEscapeComment(sourceCode, node)) return;
        context.report({ node, messageId: 'jsxLeak', data: { name: node.callee.name } });
      },

      VariableDeclarator(node) {
        if (isClientFile) return;
        const init = node.init;
        if (
          init?.type !== 'CallExpression' ||
          init.callee.type !== 'Identifier' ||
          !trackedLocals.has(init.callee.name)
        ) {
          return;
        }
        const name = init.callee.name;
        for (const variable of sourceCode.getDeclaredVariables(node)) {
          for (const reference of variable.references) {
            const identifier = reference.identifier;
            if (identifier === node.id) continue;
            if (!isInsideJsx(identifier)) continue;
            if (hasEscapeComment(sourceCode, identifier)) continue;
            context.report({ node: identifier, messageId: 'jsxLeak', data: { name } });
          }
        }
      },
    };
  },
};
