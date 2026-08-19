/**
 * myclash/no-raw-api-fetch
 *
 * A ratchet, not a sweep. It converts nothing. The hand-rolled calls that
 * predate it are counted, file by file, in no-raw-api-fetch-baseline.json —
 * the only place in the repo where that number is measured rather than
 * recited — and it refuses the next one.
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
 *  1. `no-raw-api-fetch-baseline.json` — repo-root path → how many hand-rolled
 *     fetches that file is still allowed. A COUNT, not a flag: a file-level
 *     allowlist would have made "stops number 868" false the moment 868 landed
 *     inside one of the 246 files already listed, which is the same shape as a
 *     gate counting FILES while the rule that reads them has collapsed. The
 *     total is asserted by this rule's test, so the list can only shrink where
 *     a reviewer sees it.
 *  2. `// raw-fetch-exempt` on the line above — for the call that genuinely is
 *     not an API read, with the reason next to it. An exempted call does not
 *     spend the file's allowance.
 *
 * The module that owns the fetch is not an exception, it is the point.
 * `@myclash/api-client` holds the seam itself and is out of scope structurally
 * — the rule is registered in the three apps, which lint `app/` and `src/`
 * only, so it never reads that package. web-staff's offline layer IS in scope
 * and is exempted by name below: `fetchWithCache` must keep the pad scoring
 * with no network at all (hard rule 3), a different job from this seam's.
 */
import { readFileSync } from 'node:fs';

import { repoRelativeFilename } from './repo-relative-filename.mjs';

const baselineFile = new URL('./no-raw-api-fetch-baseline.json', import.meta.url);

/** repo-root path → hand-rolled fetches that file is still allowed. Shrinks. */
export const BASELINE = new Map(
  Object.entries(JSON.parse(readFileSync(baselineFile, 'utf8')).files),
);

/** What the whole list still permits — one number, asserted by the test. */
export const baselineTotal = () => [...BASELINE.values()].reduce((sum, n) => sum + n, 0);

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
      overBaseline:
        "This file is down to {{allowed}} hand-rolled fetch call(s) in eslint-rules/no-raw-api-fetch-baseline.json and this is number {{seen}}. The list only shrinks: move this call onto `apiRequest` from '@myclash/api-client' rather than raising the number.",
    },
    schema: [],
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    const relative = repoRelativeFilename(context.filename);
    if (PERMANENTLY_EXEMPT.some((prefix) => relative.startsWith(prefix))) return {};

    const allowed = BASELINE.get(relative) ?? 0;
    let seen = 0;

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
        seen += 1;
        // Source order, so the calls a file already had stay quiet and the one
        // it just grew is the one named.
        if (seen <= allowed) return;
        context.report({
          node,
          messageId: allowed > 0 ? 'overBaseline' : 'rawFetch',
          data: { allowed: String(allowed), seen: String(seen) },
        });
      },
    };
  },
};
