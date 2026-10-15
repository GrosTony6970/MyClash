import { readFileSync } from 'node:fs';

import { repoRelativeFilename } from './repo-relative-filename.mjs';

const watchedProps = new Set([
  'title',
  'aria-label',
  'placeholder',
  'alt',
  'label',
  // Widened by X4 (operator ruling 2026-10-14): the props of the page header and the
  // dialogs, which carried English the old list never read.
  'eyebrow',
  'subtitle',
  'description',
  'confirmLabel',
  'cancelLabel',
]);
// The words of a confirm()/prompt() question (an options object).
const watchedQuestionKeys = new Set([
  'title',
  'description',
  'confirmLabel',
  'cancelLabel',
  'placeholder',
]);
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

/**
 * The string leaves of an expression a person reads: a literal, a template's text, either
 * branch of a ternary, the fallback of `??` / `||`, the shown side of `&&`. A class name, an
 * id or a key never sits in these places of a watched prop or of JSX children.
 */
function textLeaves(node) {
  if (!node) return [];
  if (node.type === 'Literal' && typeof node.value === 'string') {
    return [{ node, text: node.value }];
  }
  if (node.type === 'TemplateLiteral') {
    return [{ node, text: node.quasis.map((quasi) => quasi.value.cooked ?? '').join(' ') }];
  }
  if (node.type === 'ConditionalExpression') {
    return [...textLeaves(node.consequent), ...textLeaves(node.alternate)];
  }
  if (node.type === 'LogicalExpression') {
    return node.operator === '&&'
      ? textLeaves(node.right)
      : [...textLeaves(node.left), ...textLeaves(node.right)];
  }
  return [];
}

function enclosingCall(node) {
  let current = node.parent;
  while (current && current.type !== 'CallExpression') current = current.parent;
  return current ?? node;
}

function parentElementName(node) {
  const parent = node.parent;
  if (!parent || parent.type !== 'JSXElement') return '';
  return elementName(parent.openingElement.name);
}

function isBaselined(context, node, messageId) {
  const rel = repoRelativeFilename(context.filename);
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
        if (!node.value) return;
        if (node.value.type === 'Literal') {
          if (!meaningfulText(node.value.value)) return;
          if (!isBaselined(context, node, 'literalProp')) {
            context.report({ node, messageId: 'literalProp' });
          }
          return;
        }
        if (node.value.type !== 'JSXExpressionContainer') return;
        for (const leaf of textLeaves(node.value.expression)) {
          if (!meaningfulText(leaf.text)) continue;
          if (!isBaselined(context, leaf.node, 'literalProp')) {
            context.report({ node: leaf.node, messageId: 'literalProp' });
          }
        }
      },
      JSXExpressionContainer(node) {
        // A child of an element: `{cond ? 'Yes' : 'No'}`, `{'Loading…'}`, `{`${n} items`}`.
        if (node.parent?.type !== 'JSXElement' && node.parent?.type !== 'JSXFragment') return;
        if (exemptElements.has(parentElementName(node))) return;
        if (hasEscapeComment(sourceCode, node)) return;
        for (const leaf of textLeaves(node.expression)) {
          if (!meaningfulText(leaf.text)) continue;
          if (!isBaselined(context, leaf.node, 'literalText')) {
            context.report({ node: leaf.node, messageId: 'literalText' });
          }
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
        } else if (
          callee.type === 'Identifier' &&
          (callee.name === 'confirm' || callee.name === 'prompt')
        ) {
          const arg = node.arguments[0];
          if (arg?.type === 'ObjectExpression') {
            for (const prop of arg.properties) {
              if (prop.type !== 'Property' || prop.computed) continue;
              const key = prop.key.type === 'Identifier' ? prop.key.name : prop.key.value;
              if (!watchedQuestionKeys.has(key)) continue;
              reportCallText(prop.value);
            }
          }
          return;
        }
        if (!target) return;
        reportCallText(target);
      },
    };

    function reportCallText(target) {
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
      if (
        hasEscapeComment(sourceCode, target) ||
        hasEscapeComment(sourceCode, enclosingCall(target))
      )
        return;

      if (!isBaselined(context, target, 'literalCall')) {
        context.report({ node: target, messageId: 'literalCall' });
      }
    }
  },
};
