import { readFileSync } from 'node:fs';

const watchedProps = new Set(['title', 'aria-label', 'placeholder', 'alt', 'label']);
const exemptElements = new Set(['code', 'kbd', 'pre', 'samp', 'script', 'style']);
// User-facing message sinks OUTSIDE JSX — the historical blind spot of this
// rule (error paths shipped English while the JSX around them was translated):
//   toast.success('...') / toast.error(`...`)   (any *toast* object)
//   confirm({ title: '...' })                    (useConfirm dialogs)
//   setError('...') and friends                  (setXxxError state setters)
//   alert('...')
const watchedToastMethods = new Set(['success', 'error', 'info', 'warning']);
const errorSetterPattern = /^set\w*Error$/u;
const baseline = JSON.parse(readFileSync(new URL('./i18n-baseline.json', import.meta.url), 'utf8'));

function elementName(node) {
  if (!node) return '';
  if (node.type === 'JSXIdentifier') return node.name;
  if (node.type === 'JSXMemberExpression') return elementName(node.property);
  return '';
}

function hasEscapeComment(sourceCode, node) {
  return sourceCode
    .getCommentsBefore(node)
    .some((comment) => /i18n-exempt|myclash-i18n-exempt/.test(comment.value));
}

function meaningfulText(value) {
  const text = String(value).replace(/\s+/g, ' ').trim();
  if (!text) return false;
  if (!/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(text)) return false;
  if (/^[A-Z0-9_./:-]+$/.test(text)) return false;
  if (/^(GET|POST|PUT|PATCH|DELETE)\s+\/[A-Za-z0-9_./:{}-]+$/.test(text)) return false;
  if (/^\/[A-Za-z0-9_./:{}-]+$/.test(text)) return false;
  return true;
}

function parentElementName(node) {
  const parent = node.parent;
  if (!parent || parent.type !== 'JSXElement') return '';
  return elementName(parent.openingElement.name);
}

function relativeFilename(filename) {
  const normalized = filename.replace(/\\/g, '/');
  const cleaned = normalized.replace(/^\.\//, '');
  if (cleaned.startsWith('app/') || cleaned.startsWith('src/')) {
    const cwd = process.cwd().replace(/\\/g, '/');
    const appsIndex = cwd.indexOf('/apps/');
    if (appsIndex >= 0) {
      return `${cwd.slice(appsIndex + 1)}/${cleaned}`;
    }
  }
  const appsIndex = normalized.indexOf('/apps/');
  return appsIndex >= 0 ? normalized.slice(appsIndex + 1) : normalized;
}

function isBaselined(context, node, messageId) {
  const rel = relativeFilename(context.filename);
  const fileBaseline =
    baseline[rel] ??
    Object.entries(baseline).find(([file]) => file.endsWith(`/${rel.replace(/^\.\//, '')}`))?.[1] ??
    [];
  return fileBaseline.includes(`${node.loc.start.line}:${node.loc.start.column + 1}:${messageId}`);
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'disallow hardcoded user-facing strings in JSX',
    },
    messages: {
      literalText: 'Move user-facing JSX text into @myclash/i18n messages.',
      literalProp: 'Move user-facing JSX prop text into @myclash/i18n messages.',
      literalCall:
        'Move user-facing message text (toast/confirm/setError/alert) into @myclash/i18n messages.',
    },
    schema: [],
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();

    return {
      JSXText(node) {
        if (exemptElements.has(parentElementName(node))) return;
        if (hasEscapeComment(sourceCode, node)) return;
        if (!meaningfulText(node.value)) return;

        if (!isBaselined(context, node, 'literalText')) {
          context.report({ node, messageId: 'literalText' });
        }
      },
      JSXAttribute(node) {
        const propName = node.name?.name;
        if (!watchedProps.has(propName)) return;
        if (hasEscapeComment(sourceCode, node)) return;
        if (!node.value || node.value.type !== 'Literal') return;
        if (!meaningfulText(node.value.value)) return;

        if (!isBaselined(context, node, 'literalProp')) {
          context.report({ node, messageId: 'literalProp' });
        }
      },
      CallExpression(node) {
        const callee = node.callee;
        let target = null;

        if (
          callee.type === 'MemberExpression' &&
          !callee.computed &&
          callee.object.type === 'Identifier' &&
          /toast/iu.test(callee.object.name) &&
          callee.property.type === 'Identifier' &&
          watchedToastMethods.has(callee.property.name)
        ) {
          target = node.arguments[0];
        } else if (
          callee.type === 'Identifier' &&
          (callee.name === 'alert' || errorSetterPattern.test(callee.name))
        ) {
          target = node.arguments[0];
        } else if (callee.type === 'Identifier' && callee.name === 'confirm') {
          const arg = node.arguments[0];
          if (arg?.type === 'ObjectExpression') {
            const titleProp = arg.properties.find(
              (prop) =>
                prop.type === 'Property' &&
                !prop.computed &&
                ((prop.key.type === 'Identifier' && prop.key.name === 'title') ||
                  (prop.key.type === 'Literal' && prop.key.value === 'title')),
            );
            target = titleProp?.value ?? null;
          }
        }
        if (!target) return;

        let text = null;
        if (target.type === 'Literal' && typeof target.value === 'string') {
          text = target.value;
        } else if (target.type === 'TemplateLiteral') {
          text = target.quasis.map((quasi) => quasi.value.cooked ?? '').join(' ');
        }
        if (text === null || !meaningfulText(text)) return;
        // Single camelCase/lowercase tokens are error CODES the component maps
        // to i18n keys itself (e.g. setActionError('nameInUse')) — not display
        // text. Real messages contain whitespace or punctuation.
        if (/^[a-z][a-zA-Z0-9_-]*$/u.test(text.trim())) return;
        if (hasEscapeComment(sourceCode, node) || hasEscapeComment(sourceCode, target)) return;

        if (!isBaselined(context, target, 'literalCall')) {
          context.report({ node: target, messageId: 'literalCall' });
        }
      },
    };
  },
};
