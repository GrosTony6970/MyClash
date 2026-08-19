import assert from 'node:assert/strict';
import test from 'node:test';

import { describeParseFailure, extractFences } from './check-mermaid.mjs';

const doc = (...lines) => lines.join('\n');

test('a fence is returned with its code and the line it opens on', () => {
  const source = doc('# Title', '', '```mermaid', 'graph TD', '  A --> B', '```', 'after');

  assert.deepEqual(extractFences(source, 'docs/a.md'), [
    { rel: 'docs/a.md', line: 3, code: 'graph TD\n  A --> B' },
  ]);
});

test('several fences in one document are all found', () => {
  const source = doc('```mermaid', 'graph TD', '```', 'prose', '```mermaid', 'flowchart LR', '```');

  assert.deepEqual(
    extractFences(source, 'docs/a.md').map((fence) => fence.line),
    [1, 5],
  );
});

test('a fence in another language is not a mermaid diagram', () => {
  const source = doc('```ts', 'const a = 1;', '```', '```', 'plain', '```');

  assert.deepEqual(extractFences(source, 'docs/a.md'), []);
});

test('a mermaid fence nested in prose about ```mermaid is still located by its opener', () => {
  // The opener has to be the WHOLE trimmed line, so a sentence mentioning the
  // fence marker inline does not start a diagram.
  const source = doc('Write a ```mermaid block like this:', '```mermaid', 'graph TD', '```');

  assert.deepEqual(
    extractFences(source, 'docs/a.md').map((fence) => fence.line),
    [2],
  );
});

test('an unterminated fence runs to the end of the document rather than being dropped', () => {
  // Silently skipping it would let a broken diagram through on a missing close.
  const source = doc('```mermaid', 'graph TD', '  A --> B');

  assert.deepEqual(extractFences(source, 'docs/a.md'), [
    { rel: 'docs/a.md', line: 1, code: 'graph TD\n  A --> B' },
  ]);
});

test('an indented fence is recognised', () => {
  const source = doc('- item:', '  ```mermaid', '  graph TD', '  ```');

  assert.equal(extractFences(source, 'docs/a.md').length, 1);
});

test('a failure names the file, the line and the first line of the diagram', () => {
  const fence = { rel: 'docs/a.md', line: 12, code: '\ngraph TD\n  A --> B\n' };

  const described = describeParseFailure(fence, new Error('Parse error on line 2'));

  assert.match(described, /^docs\/a\.md:12 \(graph TD\)/);
  assert.match(described, /Parse error on line 2/);
});

test('a long complaint is trimmed to three lines so one bad diagram cannot bury the rest', () => {
  const fence = { rel: 'docs/a.md', line: 1, code: 'graph TD' };
  const noisy = new Error(['one', 'two', 'three', 'four', 'five'].join('\n'));

  const described = describeParseFailure(fence, noisy);

  assert.match(described, /one/);
  assert.match(described, /three/);
  assert.doesNotMatch(described, /four/);
});
