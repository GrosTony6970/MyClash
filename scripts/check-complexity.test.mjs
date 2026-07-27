import assert from 'node:assert/strict';
import test from 'node:test';
import { findFunctionHotspots } from './check-complexity.mjs';

/** A function body of `n` filler lines, so total length is predictable. */
function filler(n) {
  return Array.from({ length: n }, (_, i) => `  const v${i} = ${i};`).join('\n');
}

/** Just the reported lengths, for terse assertions. */
function lengths(hotspots) {
  return hotspots.map((h) => Number(/: (\d+) lines:/.exec(h.display)[1]));
}

function labels(hotspots) {
  return hotspots.map((h) => /: \d+ lines: (.*)$/.exec(h.display)[1]);
}

test('flags a function over the 50-line limit', () => {
  const source = `function big() {\n${filler(60)}\n}\n`;
  const found = findFunctionHotspots(source, 'a.ts');
  assert.equal(found.length, 1);
  assert.deepEqual(lengths(found), [62]);
  assert.deepEqual(labels(found), ['big']);
});

test('ignores a function at or under the limit', () => {
  const source = `function small() {\n${filler(40)}\n}\n`;
  assert.deepEqual(findFunctionHotspots(source, 'a.ts'), []);
});

// ── The regression this rewrite exists for ───────────────────────────────────
// The previous detector counted `{` and `}` over raw text. A brace inside a
// string closed the frame early, the measured length collapsed under the limit,
// and the function disappeared from the report. Two identical functions, one
// with a brace in a string: the old detector reported only the second.
test('counts braces inside string literals as text, not structure', () => {
  const source = [
    'function alpha() {',
    '  const tpl = "}";',
    filler(60),
    '  return tpl;',
    '}',
    '',
    'function beta() {',
    '  const tpl = "ok";',
    filler(60),
    '  return tpl;',
    '}',
  ].join('\n');

  const found = findFunctionHotspots(source, 'a.ts');
  assert.deepEqual(labels(found), ['alpha', 'beta']);
  // Identical bodies must measure identically.
  const [alpha, beta] = lengths(found);
  assert.equal(alpha, beta);
});

test('counts braces inside template literals and comments as text', () => {
  const source = [
    'function alpha() {',
    '  const tpl = `a } b ${1} c`;',
    '  // trailing } in a comment',
    '  /* and } in a block comment */',
    filler(60),
    '}',
  ].join('\n');

  const found = findFunctionHotspots(source, 'a.ts');
  assert.deepEqual(labels(found), ['alpha']);
  // signature + 3 comment/string lines + 60 filler + closing brace
  assert.deepEqual(lengths(found), [65]);
});

test('counts braces inside regex literals as text', () => {
  const source = ['function alpha() {', '  const re = /[}]/;', filler(60), '}'].join('\n');
  assert.deepEqual(labels(findFunctionHotspots(source, 'a.ts')), ['alpha']);
});

// ── Naming ───────────────────────────────────────────────────────────────────

test('qualifies a method with its class', () => {
  const source = [
    'class PhasesService {',
    '  async populateBracket() {',
    filler(60),
    '  }',
    '}',
  ].join('\n');
  assert.deepEqual(labels(findFunctionHotspots(source, 'a.ts')), ['PhasesService.populateBracket']);
});

test('names an arrow assigned to a const', () => {
  const source = `const handler = async () => {\n${filler(60)}\n};\n`;
  assert.deepEqual(labels(findFunctionHotspots(source, 'a.ts')), ['handler']);
});

test('skips a genuinely anonymous inline callback', () => {
  // Its lines already count towards `outer`; reporting both would charge the
  // same code twice and bury the signal under hundreds of callbacks.
  const source = [
    'function outer() {',
    '  return items.map((item) => {',
    filler(60),
    '    return item;',
    '  });',
    '}',
  ].join('\n');
  assert.deepEqual(labels(findFunctionHotspots(source, 'a.ts')), ['outer']);
});

test('reports a nested named function separately from its parent', () => {
  const source = [
    'function outer() {',
    '  function inner() {',
    filler(60),
    '  }',
    filler(60),
    '}',
  ].join('\n');
  assert.deepEqual(labels(findFunctionHotspots(source, 'a.ts')), ['outer', 'inner']);
});

// ── Signatures the old regex could not match ────────────────────────────────

test('handles a multi-line parameter list', () => {
  // The old detector required `(...)  {` to close on ONE line, so a destructured
  // multi-line signature never registered as a function start.
  const source = [
    'export function Component({',
    '  first,',
    '  second,',
    '}: Props) {',
    filler(60),
    '}',
  ].join('\n');
  assert.deepEqual(labels(findFunctionHotspots(source, 'a.tsx')), ['Component']);
});

test('parses TSX and measures a JSX-returning component', () => {
  const source = [
    'export function Card() {',
    '  return (',
    '    <div className="x">',
    filler(60),
    '      <span>{"}"}</span>',
    '    </div>',
    '  );',
    '}',
  ].join('\n');
  assert.deepEqual(labels(findFunctionHotspots(source, 'a.tsx')), ['Card']);
});

test('does not mistake a control-flow keyword for a function', () => {
  const source = ['function outer() {', '  if (cond) {', filler(60), '  }', '}'].join('\n');
  assert.deepEqual(labels(findFunctionHotspots(source, 'a.ts')), ['outer']);
});

test('reports the line the function starts on', () => {
  const source = ['// leading comment', '', 'function big() {', filler(60), '}'].join('\n');
  const [found] = findFunctionHotspots(source, 'a.ts');
  assert.match(found.id, /^a\.ts:3$/);
});

test('returns hotspots in source order', () => {
  const source = [
    `function first() {\n${filler(60)}\n}`,
    `function second() {\n${filler(60)}\n}`,
  ].join('\n');
  assert.deepEqual(labels(findFunctionHotspots(source, 'a.ts')), ['first', 'second']);
});
