/**
 * require-field-name — a form field with a placeholder must have a name of its own (quick win
 * X5, operator ruling 2026-10-14).
 *
 * A placeholder is not a name: it vanishes as soon as a person types, a screen reader may skip
 * it, and an example ("12 rue des Lilas") says nothing about what the field is. So a field that
 * shows one must also carry a name:
 *   - `aria-label` or `aria-labelledby`;
 *   - the shared components' own name prop: `label` (Input), `fieldLabel` (PromptDialog);
 *   - a `<label>` around it;
 *   - an `id` that a `htmlFor` in the same file points at (same expression or same literal).
 * A field whose props are spread (`{...rest}`) passes: its name comes from its caller, and the
 * caller is checked where it renders the shared component.
 *
 * Fields: `input`, `textarea`, `select`, and the shared `Input` and `PromptDialog`.
 */
const FIELDS = new Set(['input', 'textarea', 'select', 'Input', 'PromptDialog']);
const NAME_ATTRIBUTES = new Set(['aria-label', 'aria-labelledby', 'label', 'fieldLabel']);

function elementName(node) {
  if (!node) return '';
  if (node.type === 'JSXIdentifier') return node.name;
  if (node.type === 'JSXMemberExpression') return elementName(node.property);
  return '';
}

function attribute(opening, name) {
  return opening.attributes.find(
    (attr) => attr.type === 'JSXAttribute' && attr.name?.name === name,
  );
}

function insideLabel(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (current.type === 'JSXElement' && elementName(current.openingElement.name) === 'label') {
      return true;
    }
  }
  return false;
}

export default {
  meta: {
    type: 'problem',
    docs: { description: 'require a name on a form field that shows a placeholder' },
    messages: {
      noName:
        'This field shows a placeholder but has no name. Give it an aria-label (a key of its own; a search box may reuse its placeholder), a <label>, or an id a htmlFor points at.',
    },
    schema: [],
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    const htmlForTargets = new Set();
    const pending = [];

    const valueText = (attr) => (attr.value ? sourceCode.getText(attr.value) : '');

    return {
      JSXAttribute(node) {
        if (node.name?.name === 'htmlFor' && node.value) htmlForTargets.add(valueText(node));
      },
      JSXOpeningElement(node) {
        if (!FIELDS.has(elementName(node.name))) return;
        if (!attribute(node, 'placeholder')) return;
        if (node.attributes.some((attr) => attr.type === 'JSXSpreadAttribute')) return;
        if ([...NAME_ATTRIBUTES].some((name) => attribute(node, name))) return;
        if (insideLabel(node)) return;
        const id = attribute(node, 'id');
        pending.push({ node, id: id ? valueText(id) : null });
      },
      'Program:exit'() {
        for (const { node, id } of pending) {
          if (id !== null && htmlForTargets.has(id)) continue;
          context.report({ node, messageId: 'noName' });
        }
      },
    };
  },
};
