/**
 * Every multipart read goes through `read-upload.ts`. A route that calls the plugin by hand reads
 * up to the 1 GiB ceiling before any check of its own, and a too-large file is a reported 500
 * (operator ruling, 2026-10-30: each upload stops at its own limit).
 *
 * The scan walks the syntax tree of every API source file, the test support folder included, and
 * finds a call of the plugin's request readers, written plainly or as an optional call. Comments
 * and strings are not code to it.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { apiSourceFiles } from './testing/supabase-query-scan';

const READERS = new Set(['file', 'files', 'parts', 'saveRequestFiles', 'formData']);
// Every call the tree walk finds has a reader's name after a dot. A file with none is not parsed:
// parsing all ~1,500 files took 9 s under coverage and timed the test out.
const MENTION = /\.\s*(?:file|files|parts|saveRequestFiles|formData)\b/;
const SRC = path.resolve(__dirname, '..');
const OWNER = path.join(SRC, 'common', 'read-upload.ts');

/** The `line: .name(` of each plugin reader called in `source`. */
function readerCalls(source: string, file = 'probe.ts'): string[] {
  if (!MENTION.test(source)) return [];
  const found: string[] = [];
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      READERS.has(node.expression.name.text)
    ) {
      const { line } = tree.getLineAndCharacterOfPosition(node.getStart());
      found.push(`${line + 1}: .${node.expression.name.text}(`);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return found;
}

describe('the upload source guard', () => {
  it('finds each way a reader is called, and not a mention of one', () => {
    const source = [
      'await req.file();',
      'await maybeReq.file?.();',
      'for await (const p of req.parts()) {}',
      'await req.saveRequestFiles();',
      '// req.file() in a comment',
      "const s = 'req.parts()';",
    ].join('\n');
    expect(readerCalls(source)).toEqual([
      '1: .file(',
      '2: .file(',
      '3: .parts(',
      '4: .saveRequestFiles(',
    ]);
  });

  it('finds a call split over lines, the dot on its own line', () => {
    expect(readerCalls('await req\n  .file\n  ?.();')).toEqual(['1: .file(']);
  });

  it('finds none outside read-upload.ts', () => {
    const files = apiSourceFiles(SRC);
    // The walk reached the API: hundreds of files, the owner and the test support among them.
    expect(files.length).toBeGreaterThan(300);
    expect(files).toContain(OWNER);
    expect(files).toContain(path.join(SRC, 'common', 'testing', 'http-edge-app.ts'));

    const byHand = files
      .filter((file) => file !== OWNER)
      .flatMap((file) =>
        readerCalls(readFileSync(file, 'utf8'), file).map(
          (call) => `${path.relative(SRC, file)}:${call}`,
        ),
      );
    expect(byHand).toEqual([]);
  });
});
