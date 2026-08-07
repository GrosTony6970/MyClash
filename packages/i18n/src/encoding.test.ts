import assert from 'node:assert/strict';
import { messages } from './index';

/**
 * encoding.test.ts
 *
 * Guards the message tree against mojibake — UTF-8 bytes that were read back as
 * Windows-1252 and re-saved, turning `é` into `Ã©` and, when it happened twice,
 * into `ÃƒÂ©`. 63 French strings across five sections (`dashboard`, `leagues`,
 * `backups`, `systemVersions`, `archive`) had rotted that way and shipped to
 * operators; nothing caught it, because mojibake is valid TypeScript, valid
 * JSON and valid UTF-8. Only a human reading French would have noticed.
 *
 * The check is not a blocklist of bad characters — `Â` and `à` are legitimate
 * French. It is a round-trip: a string is mojibake exactly when re-reading its
 * characters as CP1252 bytes yields valid UTF-8 that differs from the original.
 * A correct string either has no marker or fails to decode, and is left alone.
 */

// The bytes 0x80-0x9F, which Latin-1 leaves undefined but Windows-1252 maps to
// typographic characters. Mojibake produced on Windows carries these, so a
// plain latin1 round-trip cannot undo it — `ÃƒÂ©` contains `ƒ` (U+0192 = 0x83).
const CP1252_HIGH = new Map<string, number>([
  ['€', 0x80],
  ['‚', 0x82],
  ['ƒ', 0x83],
  ['„', 0x84],
  ['…', 0x85],
  ['†', 0x86],
  ['‡', 0x87],
  ['ˆ', 0x88],
  ['‰', 0x89],
  ['Š', 0x8a],
  ['‹', 0x8b],
  ['Œ', 0x8c],
  ['Ž', 0x8e],
  ['‘', 0x91],
  ['’', 0x92],
  ['“', 0x93],
  ['”', 0x94],
  ['•', 0x95],
  ['–', 0x96],
  ['—', 0x97],
  ['˜', 0x98],
  ['™', 0x99],
  ['š', 0x9a],
  ['›', 0x9b],
  ['œ', 0x9c],
  ['ž', 0x9e],
  ['Ÿ', 0x9f],
]);

/** Lead bytes of the two- and three-byte UTF-8 sequences French and the
 *  typographic punctuation actually use — `Ã`, `Â`, `â€`. */
const MARKER = /[ÃÂ]|â€/;

function toBytes(text: string): Buffer | null {
  const out: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp <= 0xff) out.push(cp);
    else {
      const mapped = CP1252_HIGH.get(ch);
      if (mapped === undefined) return null;
      out.push(mapped);
    }
  }
  return Buffer.from(out);
}

function decodeOnce(text: string): string | null {
  const bytes = toBytes(text);
  if (!bytes) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** Undo up to four rounds of "UTF-8 read as CP1252". Stops the moment a round
 *  fails to decode, so a correctly encoded string comes back unchanged. */
function demojibake(text: string): string {
  let current = text;
  for (let round = 0; round < 4; round += 1) {
    if (!MARKER.test(current)) break;
    const next = decodeOnce(current);
    if (next === null || next === current) break;
    current = next;
  }
  return current;
}

function collectStrings(value: unknown, prefix = ''): Array<[string, string]> {
  if (typeof value === 'string') return [[prefix, value]];
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    collectStrings(child, prefix ? `${prefix}.${key}` : key),
  );
}

const rotted: string[] = [];
for (const locale of ['en', 'fr'] as const) {
  for (const [key, text] of collectStrings(messages[locale])) {
    const repaired = demojibake(text);
    if (repaired !== text) rotted.push(`${locale}.${key}: ${text} → ${repaired}`);
  }
}

assert.deepEqual(rotted, [], `Mojibake in the message tree:\n  ${rotted.join('\n  ')}`);

/** Inverse of `decodeOnce` — reads a string's UTF-8 bytes back as CP1252.
 *  Used to BUILD the fixtures below rather than pasting rotted literals: a
 *  hand-typed `ÃƒÂ ` is one invisible NBSP away from not being mojibake at
 *  all, and a fixture that silently stops reproducing the bug tests nothing. */
const CP1252_FROM_BYTE = new Map([...CP1252_HIGH].map(([ch, byte]) => [byte, ch]));
function rot(text: string): string {
  return [...Buffer.from(text, 'utf8')]
    .map((byte) => CP1252_FROM_BYTE.get(byte) ?? String.fromCharCode(byte))
    .join('');
}

// The detector must actually detect: one round of rot, and the two rounds the
// archive section had suffered.
for (const sample of ['Accès refusé.', "Retour à l'événement", 'Périmètre', 'Événement']) {
  assert.notEqual(rot(sample), sample);
  assert.equal(demojibake(rot(sample)), sample);
  assert.equal(demojibake(rot(rot(sample))), sample);
  // …and must leave a correct string exactly as it found it.
  assert.equal(demojibake(sample), sample);
}
assert.equal(demojibake('Back to platform accounts'), 'Back to platform accounts');

console.log(`i18n encoding: ${collectStrings(messages.fr).length} fr strings free of mojibake.`);
