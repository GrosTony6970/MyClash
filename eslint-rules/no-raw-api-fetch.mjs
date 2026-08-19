/**
 * myclash/no-raw-api-fetch
 *
 * A ratchet, not a sweep. The three web apps hold ~867 hand-rolled `fetch`
 * calls; this rule does not convert one of them. It stops number 868.
 *
 * The repo has already tried the other way twice. `createApiClient` shipped
 * with a docstring telling web-staff to use it and reached four call sites.
 * `apiErrorMessage` was written specifically to stop hand-rolled error reads,
 * says so in its own docstring, and reached one consumer against 177 inline
 * `res.json().catch(...)` copies. A shared module with no enforcement is a
 * suggestion, and this codebase does not take suggestions.
 *
 * ── Why bare `fetch` and not "a fetch whose URL says /api/v1" ───────────────
 * Because the URL is not always in the call. `const endpoint = …; await
 * fetch(endpoint, …)` is already the idiom in four places under app/admin, so a
 * rule keyed on the argument text would be bypassed by naming a variable —
 * accidentally, most of the time. Nothing under app/ or src/ in these three
 * apps fetches a non-API absolute URL, so the exceptions can be enumerated
 * instead of guessed at.
 *
 * ── The two exits ──────────────────────────────────────────────────────────
 *  1. `no-raw-api-fetch-baseline.json` — the files that already hand-roll it.
 *     Keyed by repo-root path, one line per file, and it only ever shrinks:
 *     convert a file, delete its line. The count is asserted by this rule's
 *     test, so growing the list has to change a number a reviewer can see.
 *  2. `// raw-fetch-exempt` on the line above — for the call that genuinely is
 *     not an API read, with the reason next to it.
 *
 * The module that owns the fetch is not an exception, it is the point:
 * `@myclash/api-client` and web-staff's offline layer are permanently out of
 * scope. web-staff's `fetchWithCache` must keep the pad scoring with no
 * network at all (hard rule 3), which is a different job from this seam's.
 */
import { readFileSync } from 'node:fs';

import { repoRelativeFilename } from './repo-relative-filename.mjs';

const baselineFile = new URL('./no-raw-api-fetch-baseline.json', import.meta.url);

/** Files that hand-roll a fetch today. Shrinks; never grows. */
export const BASELINE = new Set(JSON.parse(readFileSync(baselineFile, 'utf8')).files);

/**
 * Not a baseline: these own a fetch by design and are never converted.
 * Prefix-matched, so a whole directory can be named.
 */
export const PERMANENTLY_EXEMPT = ['apps/web-staff/src/offline/'];

/**
 * By LINE, not by `getCommentsBefore`. The call is rarely the node a comment
 * attaches to — `await fetch(...)` puts an AwaitExpression in between, and an
 * assignment puts a declarator — so token-adjacency would silently ignore an
 * escape comment written exactly where a human would write it.
 */
function hasEscapeComment(sourceCode, node) {
  const line = node.loc.start.line;
  return sourceCode
    .getAllComments()
    .some(
      (comment) =>
        /raw-fetch-exempt/u.test(comment.value) &&
        comment.loc.end.line >= line - 1 &&
        comment.loc.end.line <= line,
    );
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'disallow a hand-rolled fetch outside the @myclash/api-client seam',
    },
    messages: {
      rawFetch:
        "Don't hand-roll a fetch. Use `apiRequest` from '@myclash/api-client': it owns the session cookie, the problem+json `detail` read and the one abort classification, and it never throws, so this call site needs no catch. Map the failure with `failureMessage` from '@/lib/api-failure'. A deliberate non-API fetch takes a leading `// raw-fetch-exempt` comment with the reason.",
    },
    schema: [],
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    const relative = repoRelativeFilename(context.filename);
    if (BASELINE.has(relative)) return {};
    if (PERMANENTLY_EXEMPT.some((prefix) => relative.startsWith(prefix))) return {};

    return {
      CallExpression(node) {
        const callee = node.callee;
        const isFetch =
          (callee.type === 'Identifier' && callee.name === 'fetch') ||
          (callee.type === 'MemberExpression' &&
            callee.property.type === 'Identifier' &&
            callee.property.name === 'fetch' &&
            callee.object.type === 'Identifier' &&
            (callee.object.name === 'window' || callee.object.name === 'globalThis'));
        if (!isFetch) return;
        if (hasEscapeComment(sourceCode, node)) return;
        context.report({ node, messageId: 'rawFetch' });
      },
    };
  },
};
