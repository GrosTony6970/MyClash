/**
 * check-mermaid.mjs — parse every ```mermaid block in the docs with Mermaid itself.
 *
 * Why this gate exists: a Mermaid block with a syntax error does not fail loudly.
 * GitHub renders it as a plain grey code block, so a broken diagram looks like a
 * formatting quirk and survives review indefinitely. Prettier does not parse
 * fence contents, so nothing else catches it.
 *
 * Mermaid's parser needs a DOM even for `parse()` (no rendering happens here),
 * hence the jsdom shim.
 *
 * Usage: node scripts/check-mermaid.mjs [file ...]   (defaults to docs/**\/*.md)
 */
import { readFile } from 'node:fs/promises';
import { glob } from 'node:fs/promises';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const rootDir = path.resolve(import.meta.dirname, '..');

async function targets() {
  const argv = process.argv.slice(2);
  if (argv.length > 0) return argv;
  const found = [];
  for await (const entry of glob('docs/**/*.md', { cwd: rootDir })) found.push(entry);
  found.push('README.md', 'CONTRIBUTING.md');
  return found.sort();
}

function installDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
  // Node defines some of these as getter-only globals, so assignment throws.
  const define = (name, value) =>
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  for (const name of [
    'window',
    'document',
    'navigator',
    'HTMLElement',
    'SVGElement',
    'Element',
    'Node',
    'getComputedStyle',
  ]) {
    define(name, name === 'window' ? dom.window : dom.window[name]);
  }
  define('requestAnimationFrame', (cb) => setTimeout(cb, 0));
}

installDom();
const { default: mermaid } = await import('mermaid');
mermaid.initialize({ startOnLoad: false, securityLevel: 'loose' });

const errors = [];
let checked = 0;

for (const rel of await targets()) {
  let text;
  try {
    text = await readFile(path.join(rootDir, rel), 'utf8');
  } catch {
    continue; // optional file (README/CONTRIBUTING may not exist in every checkout)
  }

  // Track the line each fence starts on so a failure points somewhere useful.
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== '```mermaid') continue;
    const start = i;
    let end = i + 1;
    while (end < lines.length && lines[end].trim() !== '```') end++;
    const code = lines.slice(start + 1, end).join('\n');
    i = end;

    checked++;
    try {
      await mermaid.parse(code);
    } catch (err) {
      const first = code.trim().split('\n')[0];
      errors.push(
        `${rel}:${start + 1} (${first})\n    ${String(err?.message ?? err)
          .split('\n')
          .slice(0, 3)
          .join('\n    ')}`,
      );
    }
  }
}

if (errors.length > 0) {
  console.error(`Mermaid parse failures (${errors.length}/${checked}):\n`);
  for (const e of errors) console.error(`  - ${e}\n`);
  console.error('These render as plain code blocks on GitHub rather than diagrams.');
  process.exit(1);
}

console.log(`Mermaid: ${checked} diagram${checked === 1 ? '' : 's'} parsed successfully.`);
