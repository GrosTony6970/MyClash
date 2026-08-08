/**
 * myclash/no-raw-palette-color
 *
 * Keeps raw Tailwind palette classes out of styled code, so the semantic
 * tokens in packages/ui/src/theme.css stay the single source of truth.
 *
 * A class like `bg-slate-800` is a fixed hex. It does not respond to
 * `[data-theme='dark']` / `[data-theme='light']`, so a component written that
 * way silently ignores the scope it is rendered in. That is exactly how
 * web-staff accumulated 137 of them: the app sets `data-theme='dark'` on
 * <body>, its light chrome could not express itself in tokens, and every one of
 * those surfaces hardcoded slate-* instead. Nothing caught it, because
 * `pnpm design:lint` only checks that DESIGN.md's documented VALUES match
 * theme.css — it never looks at how components spend them.
 *
 * Flags palette classes anywhere a class string can live (JSX className, a
 * lookup table of variants, a clsx() argument, a template literal), because in
 * practice they are just as often in a `const` map as inline.
 *
 * Deliberate exceptions exist and are expected — DOMAIN colours that are not
 * decoration and must not follow a theme:
 *   - fighter corner red/blue (rule semantics; see theme.css)
 *   - penalty card yellow/red/black (a yellow card is yellow, everywhere)
 *   - status FILLS tuned for text contrast in web-staff's dark mode
 *     (see docs/design/known-deviations.md#d5)
 * Mark those with a leading `// raw-color-exempt` comment and say why. An
 * exemption without a reason is a bug report waiting to happen.
 */

const PREFIXES = [
  'bg',
  'text',
  'border',
  'ring',
  'ring-offset',
  'divide',
  'outline',
  'shadow',
  'accent',
  'caret',
  'decoration',
  'fill',
  'stroke',
  'from',
  'via',
  'to',
].join('|');

const HUES = [
  'slate',
  'gray',
  'zinc',
  'neutral',
  'stone',
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'purple',
  'fuchsia',
  'pink',
  'rose',
].join('|');

/**
 * Matches an entire class token, so `bg-red-600` is flagged while a semantic
 * `bg-danger` is not, and an unrelated identifier that merely contains the
 * substring (`border-border`) can never match. Variants are allowed to prefix
 * it (`hover:`, `sm:`, `dark:`, `group-hover:`, `focus-visible:`).
 */
const RAW_CLASS = new RegExp(
  String.raw`(?<![\w-])(?:[a-z][\w.:\[\]/-]*:)*(?:${PREFIXES})-(?:${HUES})-\d{2,3}(?![\w-])`,
  'u',
);

const EXEMPT = /raw-color-exempt/u;

/**
 * True when the node, or anything it sits inside up to the statement level,
 * carries the escape comment. Climbing matters: a variants map wants ONE
 * comment above the object, not one per property.
 */
function hasEscapeComment(sourceCode, node) {
  let current = node;
  while (current) {
    const comments = sourceCode.getCommentsBefore(current);
    if (comments.some((comment) => EXEMPT.test(comment.value))) return true;
    // JSX attributes carry their comments on the opening element.
    if (current.type === 'Program') break;
    current = current.parent;
  }
  return false;
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'disallow raw Tailwind palette classes; use the semantic tokens from @myclash/ui theme.css',
    },
    messages: {
      rawColor:
        "'{{match}}' is a raw palette class — a fixed hex that ignores the [data-theme] scope it renders in, so it breaks the moment this surface is themed. Use a semantic token (bg-surface / text-foreground / text-muted / border-border / bg-accent / danger|success|warning|info|strong|gold). If this is a DOMAIN colour that must never follow a theme (fighter corners, penalty cards), add a leading `// raw-color-exempt` comment explaining why.",
    },
    schema: [],
  },

  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();

    function check(node, value) {
      if (typeof value !== 'string') return;
      const found = RAW_CLASS.exec(value);
      if (!found) return;
      if (hasEscapeComment(sourceCode, node)) return;
      context.report({ node, messageId: 'rawColor', data: { match: found[0] } });
    }

    return {
      Literal(node) {
        check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.cooked ?? node.value.raw);
      },
    };
  },
};
