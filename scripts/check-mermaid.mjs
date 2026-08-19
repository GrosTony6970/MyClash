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

import { defineGate } from './lib/gate.mjs';

const rootDir = path.resolve(import.meta.dirname, '..');

async function targets(argv) {
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

/**
 * Every ```mermaid fence in one document, with the line it opens on so a failure
 * points somewhere useful. Pure text work — no DOM, no parser, no filesystem.
 */
export function extractFences(text, rel) {
  const lines = text.split('\n');
  const fences = [];

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== '```mermaid') continue;
    const start = i;
    let end = i + 1;
    while (end < lines.length && lines[end].trim() !== '```') end++;
    fences.push({ rel, line: start + 1, code: lines.slice(start + 1, end).join('\n') });
    i = end;
  }

  return fences;
}

/** One parse failure, trimmed to the first three lines of mermaid's complaint. */
export function describeParseFailure({ rel, line, code }, error) {
  const first = code.trim().split('\n')[0];
  const detail = String(error?.message ?? error)
    .split('\n')
    .slice(0, 3)
    .join('\n    ');
  return `${rel}:${line} (${first})\n    ${detail}`;
}

/** Read the documents that exist, and collect every fence in them. */
async function collectFences(argv) {
  const documents = [];
  const fences = [];

  for (const rel of await targets(argv)) {
    let text;
    try {
      text = await readFile(path.join(rootDir, rel), 'utf8');
    } catch {
      continue; // optional file (README/CONTRIBUTING may not exist in every checkout)
    }
    documents.push(rel);
    fences.push(...extractFences(text, rel));
  }

  return { documents, fences };
}

export const gate = defineGate({
  name: 'Mermaid diagrams',
  entry: import.meta.url,
  run: async ({ argv }) => {
    // The DOM shim and the parser load HERE rather than at module scope. Mermaid
    // needs a DOM even to parse, and installing one defines eight globals on
    // globalThis — a side effect no importer of this file should inherit just
    // for reading extractFences.
    installDom();
    const { default: mermaid } = await import('mermaid');
    mermaid.initialize({ startOnLoad: false, securityLevel: 'loose' });

    const { documents, fences } = await collectFences(argv);
    const findings = [];
    for (const fence of fences) {
      try {
        await mermaid.parse(fence.code);
      } catch (error) {
        findings.push(describeParseFailure(fence, error));
      }
    }

    // Documents, not diagrams, is the anti-vacuity count: the step that can
    // silently find nothing is the glob. A document set with no fences in it is
    // a real answer, and the summary says so.
    return {
      findings,
      scanned: documents.length,
      summary: `Mermaid: ${fences.length} diagram${fences.length === 1 ? '' : 's'} across ${documents.length} document(s) parsed successfully.`,
      remedy: 'These render as plain code blocks on GitHub rather than diagrams.',
    };
  },
});
