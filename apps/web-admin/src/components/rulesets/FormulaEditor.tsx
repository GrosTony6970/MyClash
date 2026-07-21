'use client';

import { useMemo, useState } from 'react';
import { FORMULA_VARIABLE_KEYS } from '@myclash/rulesets';
import type { BinaryOperator, FormulaNode, VariableKey } from '@myclash/rulesets';
import { useI18n } from '../../i18n/I18nProvider';

type Token =
  | { kind: 'var'; name: VariableKey }
  | { kind: 'op'; op: BinaryOperator }
  | { kind: 'literal'; value: number }
  | { kind: 'lparen' }
  | { kind: 'rparen' };

interface Props {
  value: FormulaNode | null;
  onChange: (next: FormulaNode | null, validationError: string | null) => void;
  disabled?: boolean;
  /**
   * The variables offered in the palette. Defaults to the full set, so every
   * existing mount is unchanged. The double-penalty editor passes a single
   * variable (`doubleHits`, TF_v1's `n`) so it cannot reference stats that are
   * meaningless in a penalty term — the parser and AST are variable-agnostic,
   * only the palette narrows.
   */
  variables?: readonly VariableKey[];
}

const OPERATORS: BinaryOperator[] = ['+', '-', '*', '/'];

function variableLabel(t: ReturnType<typeof useI18n>['t'], v: VariableKey): string {
  return t(`admin.rulesets.variables.${v}`);
}

function tokenLabel(t: ReturnType<typeof useI18n>['t'], token: Token): string {
  switch (token.kind) {
    case 'var':
      return variableLabel(t, token.name);
    case 'op':
      return token.op;
    case 'literal':
      return String(token.value);
    case 'lparen':
      return '(';
    case 'rparen':
      return ')';
  }
}

export function FormulaEditor({
  value,
  onChange,
  disabled,
  variables = FORMULA_VARIABLE_KEYS,
}: Props) {
  const { t } = useI18n();
  const [tokens, setTokens] = useState<Token[]>(() => astToTokens(value));
  const [literalDraft, setLiteralDraft] = useState('');

  const { ast, error } = useMemo(() => parseTokens(tokens), [tokens]);

  function commit(next: Token[]) {
    setTokens(next);
    const { ast: parsed, error: err } = parseTokens(next);
    onChange(parsed, err);
  }

  function appendVar(v: VariableKey) {
    if (disabled) return;
    commit([...tokens, { kind: 'var', name: v }]);
  }
  function appendOp(op: BinaryOperator) {
    if (disabled) return;
    commit([...tokens, { kind: 'op', op }]);
  }
  function appendLiteral() {
    if (disabled) return;
    const n = Number(literalDraft);
    if (!Number.isFinite(n)) return;
    commit([...tokens, { kind: 'literal', value: n }]);
    setLiteralDraft('');
  }
  function appendParen(kind: 'lparen' | 'rparen') {
    if (disabled) return;
    commit([...tokens, { kind } as Token]);
  }
  function removeAt(idx: number) {
    if (disabled) return;
    commit(tokens.filter((_, i) => i !== idx));
  }
  function clear() {
    if (disabled) return;
    commit([]);
  }

  return (
    <div className="rounded-md border border-border bg-surface p-4">
      <div className="mb-3 flex min-h-[42px] flex-wrap items-center gap-2 rounded-md border border-border bg-background p-2">
        {/* Round 8: "Score =" prefix frames the token row as an explicit
            equation so operators don't miss that they're building the
            score formula. */}
        <span className="select-none font-mono text-sm font-semibold text-foreground-secondary">
          {t('admin.rulesets.scoreEquals')}
        </span>
        {tokens.length === 0 ? (
          <p className="text-sm italic text-muted">{t('admin.rulesets.formulaEmpty')}</p>
        ) : (
          tokens.map((token, idx) => (
            <button
              key={`${idx}-${tokenLabel(t, token)}`}
              type="button"
              onClick={() => removeAt(idx)}
              disabled={disabled}
              className={`rounded-md px-2 py-1 text-sm font-mono ${
                token.kind === 'op'
                  ? 'bg-red-100 text-red-700'
                  : token.kind === 'literal'
                    ? 'bg-amber-100 text-amber-800'
                    : token.kind === 'var'
                      ? 'bg-blue-100 text-blue-800'
                      : 'bg-slate-200 text-slate-700'
              } hover:opacity-70 disabled:opacity-50`}
              title={t('admin.rulesets.removeToken')}
            >
              {tokenLabel(t, token)}
            </button>
          ))
        )}
      </div>

      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
        {t('admin.rulesets.variablesTitle')}
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        {variables.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => appendVar(v)}
            disabled={disabled}
            className="rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50"
          >
            + {variableLabel(t, v)}
          </button>
        ))}
      </div>

      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
        {t('admin.rulesets.operatorsTitle')}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {OPERATORS.map((op) => (
          <button
            key={op}
            type="button"
            onClick={() => appendOp(op)}
            disabled={disabled}
            className="h-8 w-8 rounded-md border border-red-200 bg-red-50 font-mono text-sm font-bold text-red-700 hover:bg-red-100 disabled:opacity-50"
          >
            {op}
          </button>
        ))}
        <button
          type="button"
          onClick={() => appendParen('lparen')}
          disabled={disabled}
          className="h-8 rounded-md border border-border bg-background px-2 font-mono text-sm font-bold text-foreground-secondary hover:bg-surface disabled:opacity-50"
        >
          (
        </button>
        <button
          type="button"
          onClick={() => appendParen('rparen')}
          disabled={disabled}
          className="h-8 rounded-md border border-border bg-background px-2 font-mono text-sm font-bold text-foreground-secondary hover:bg-surface disabled:opacity-50"
        >
          )
        </button>
        <input
          type="number"
          value={literalDraft}
          onChange={(e) => setLiteralDraft(e.target.value)}
          placeholder={t('admin.rulesets.numberPlaceholder')}
          disabled={disabled}
          className="h-8 w-24 rounded-md border border-amber-200 bg-amber-50 px-2 text-xs"
        />
        <button
          type="button"
          onClick={appendLiteral}
          disabled={disabled || !literalDraft}
          className="h-8 rounded-md border border-amber-200 bg-amber-50 px-2 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
        >
          + {t('admin.rulesets.addNumber')}
        </button>
        <button
          type="button"
          onClick={clear}
          disabled={disabled || tokens.length === 0}
          className="ml-auto rounded-md border border-border px-2 py-1 text-xs font-semibold text-foreground-secondary hover:bg-background disabled:opacity-50"
        >
          {t('admin.rulesets.clearFormula')}
        </button>
      </div>

      <div className="mt-3 rounded-md border border-border bg-background p-2 text-sm">
        <span className="mr-2 text-xs font-semibold uppercase tracking-wider text-muted">
          {t('admin.rulesets.preview')}
        </span>
        {ast ? (
          <code className="font-mono text-foreground">{renderAst(ast, t)}</code>
        ) : (
          <span className="italic text-danger">{error ?? t('admin.rulesets.formulaInvalid')}</span>
        )}
      </div>
    </div>
  );
}

// ── AST <-> tokens ───────────────────────────────────────────────────────

function astToTokens(ast: FormulaNode | null): Token[] {
  if (!ast) return [];
  const out: Token[] = [];
  function walk(node: FormulaNode, parentOp?: BinaryOperator) {
    if (node.type === 'literal') {
      out.push({ kind: 'literal', value: node.value });
      return;
    }
    if (node.type === 'var') {
      out.push({ kind: 'var', name: node.name });
      return;
    }
    const needsParens = parentOp !== undefined && precedence(parentOp) > precedence(node.op);
    if (needsParens) out.push({ kind: 'lparen' });
    walk(node.left, node.op);
    out.push({ kind: 'op', op: node.op });
    walk(node.right, node.op);
    if (needsParens) out.push({ kind: 'rparen' });
  }
  walk(ast);
  return out;
}

function renderAst(ast: FormulaNode, t: ReturnType<typeof useI18n>['t']): string {
  if (ast.type === 'literal') return String(ast.value);
  if (ast.type === 'var') return variableLabel(t, ast.name);
  const left = renderAst(ast.left, t);
  const right = renderAst(ast.right, t);
  const leftP =
    ast.left.type === 'binop' && precedence(ast.op) > precedence(ast.left.op) ? `(${left})` : left;
  const rightP =
    ast.right.type === 'binop' && precedence(ast.op) >= precedence(ast.right.op)
      ? `(${right})`
      : right;
  return `${leftP} ${ast.op} ${rightP}`;
}

// ── Shunting-yard parser ─────────────────────────────────────────────────

function precedence(op: BinaryOperator): number {
  return op === '+' || op === '-' ? 1 : 2;
}

function parseTokens(tokens: Token[]): { ast: FormulaNode | null; error: string | null } {
  if (tokens.length === 0) return { ast: null, error: 'Empty formula' };

  const output: FormulaNode[] = [];
  const ops: Array<{ kind: 'op'; op: BinaryOperator } | { kind: 'lparen' }> = [];

  function applyOp() {
    const opEntry = ops.pop();
    if (!opEntry || opEntry.kind !== 'op') return false;
    const right = output.pop();
    const left = output.pop();
    if (!right || !left) return false;
    output.push({ type: 'binop', op: opEntry.op, left, right });
    return true;
  }

  for (const token of tokens) {
    if (token.kind === 'literal') {
      output.push({ type: 'literal', value: token.value });
    } else if (token.kind === 'var') {
      output.push({ type: 'var', name: token.name });
    } else if (token.kind === 'op') {
      while (
        ops.length > 0 &&
        ops[ops.length - 1]!.kind === 'op' &&
        precedence((ops[ops.length - 1] as { op: BinaryOperator }).op) >= precedence(token.op)
      ) {
        if (!applyOp()) return { ast: null, error: 'Invalid expression' };
      }
      ops.push(token);
    } else if (token.kind === 'lparen') {
      ops.push({ kind: 'lparen' });
    } else if (token.kind === 'rparen') {
      while (ops.length > 0 && ops[ops.length - 1]!.kind === 'op') {
        if (!applyOp()) return { ast: null, error: 'Invalid expression' };
      }
      const top = ops.pop();
      if (!top || top.kind !== 'lparen') return { ast: null, error: 'Mismatched parentheses' };
    }
  }

  while (ops.length > 0) {
    const top = ops[ops.length - 1]!;
    if (top.kind === 'lparen') return { ast: null, error: 'Mismatched parentheses' };
    if (!applyOp()) return { ast: null, error: 'Invalid expression' };
  }

  if (output.length !== 1) return { ast: null, error: 'Invalid expression' };
  return { ast: output[0]!, error: null };
}
