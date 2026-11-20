/**
 * The HTML part of the ops report (ruling 910): the sender dresses the agent's plain text. The
 * agent writes the twelve sections of SKILL.md §5, each name alone on a line; this splits the text
 * on those names and lays it out in the platform emails' look (`mail-templates.ts`: inline styles
 * only, a table layout, 600 px). The text part of the email stays the agent's text.
 *
 * Plain Node on purpose: the cloud run is a fresh clone with no `node_modules` and no build.
 */

/**
 * The platform's one escaper is `escapeHtml` in `packages/types/src/html.ts`. The cloud clone has
 * no build to import it from, so this is a copy, held to it character for character by
 * `scripts/ops-skill-report-html.test.mjs`.
 */
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

/** The light theme's values in `packages/ui/src/theme.css`: email cannot read a token. */
const COLOUR = {
  success: '#137337',
  warning: '#a24b08',
  danger: '#be2121',
  dangerDark: '#991b1b',
  muted: '#64748b',
  text: '#1a1a1a',
  rule: '#e5e7eb',
};

const SECTIONS = [
  'Run',
  'Running',
  'Verdict',
  'Problems (wait for you)',
  'Notes',
  'Health',
  'Containers',
  'Backups',
  'Certificates',
  'Host',
  'Logs',
  'Done by Claude',
];
const PROBLEMS = 'Problems (wait for you)';
const BY_KEY = new Map(SECTIONS.map((name) => [name.toLowerCase(), name]));
BY_KEY.set('problems', PROBLEMS);

const NOT_RECOGNISED = 'The sections of this report were not recognised. The whole text is below.';

/**
 * The section a bare name opens, or undefined. The dressing an agent puts around a name
 * (`## 4. **Problems:**`, `**3. Verdict**`) is removed until none is left, in any order. Exact
 * names only: `Run` never matches `Running`.
 */
function sectionName(raw) {
  let bare = raw.trim();
  for (let before = ''; before !== bare;) {
    before = bare;
    bare = bare
      .replace(/^#+\s*/, '')
      .replace(/^\d+\.\s*/, '')
      .replace(/:$/, '')
      .replace(/^\*\*/, '')
      .replace(/\*\*$/, '')
      .trim();
  }
  return BY_KEY.get(bare.toLowerCase());
}

/** `Verdict: all good`, `**Verdict:** all good`, `**Verdict** — all good`: name, separator, row. */
const NAME_AND_REST = /^(.+?)(?::\**|\s+[—–-])\s+(.+)$/;

/** A heading is short. A longer line is a row, and the lazy match never runs on a long log line. */
const HEADING_MAX = 120;

/**
 * `{ name, rest }` when the line is `<name>: <rest>` and the text has no bare heading for that
 * name. A problem row reads `Certificates: 5 days left`, and a health row `containers: critical`:
 * when the agent wrote those sections' bare headings, such a row must stay a row.
 */
function inlineHeading(line, bareNames) {
  if (line.length > HEADING_MAX) return null;
  const parts = line.match(NAME_AND_REST);
  const name = parts && sectionName(parts[1]);
  return name && !bareNames.has(name) ? { name, rest: parts[2].trim() } : null;
}

function heading(line, bareNames) {
  const whole = line.length <= HEADING_MAX && sectionName(line);
  return whole ? { name: whole, rest: '' } : inlineHeading(line, bareNames);
}

function row(line) {
  return line.replace(/^[-*•]\s+/, '');
}

/**
 * Splits the text into `[{ name, rows }]`; the first block has no name when text precedes. A name
 * opens a section only once, and only after the sections before it: the Logs section quotes log
 * lines, and a line that reads `Problems` there must stay a row.
 */
export function splitSections(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^[-=_*]+$/.test(line));
  const bareNames = new Set(lines.map((l) => l.length <= HEADING_MAX && sectionName(l)));
  const blocks = [{ name: null, rows: [] }];
  let next = 0;
  for (const line of lines) {
    const head = heading(line, bareNames);
    const at = head ? SECTIONS.indexOf(head.name) : -1;
    if (at >= next) {
      next = at + 1;
      blocks.push({ name: head.name, rows: head.rest ? [row(head.rest)] : [] });
    } else {
      blocks.at(-1).rows.push(row(line));
    }
  }
  return blocks.filter((block) => block.name || block.rows.length);
}

const WORD_COLOUR = new Map([
  ...['healthy', 'success', 'healed'].map((w) => [w, COLOUR.success]),
  ['warning', COLOUR.warning],
  ...['critical', 'unavailable', 'unhealthy', 'failed', 'unreachable'].map((w) => [
    w,
    COLOUR.danger,
  ]),
]);
const STATUS_WORD = new RegExp(
  `(^|[^\\w-])(not\\s+)?(${[...WORD_COLOUR.keys()].join('|')})(?![\\w-])`,
  'gi',
);

/** Colours the status words of an ESCAPED line. A green word after `not` stays plain. */
function colourWords(escaped) {
  return escaped.replace(STATUS_WORD, (match, before, not, word) => {
    const colour = WORD_COLOUR.get(word.toLowerCase());
    if (not && colour === COLOUR.success) return match;
    return `${before}${not ?? ''}<span style="color:${colour};font-weight:bold">${word}</span>`;
  });
}

/** "None" under Problems is the all-good answer, not a problem: it stays plain. "None of …" is red. */
const NO_PROBLEM = /^(none|nothing|no problems?)\b(?! of\b)/i;

/** Short styles: Gmail clips a message over 102 KB, and every log row repeats its style. */
function rowStyle(name, line) {
  if (name === PROBLEMS && !NO_PROBLEM.test(line)) return `color:${COLOUR.danger};font-weight:bold`;
  if (name === 'Logs') return 'font-family:monospace;word-break:break-all;font-size:12px';
  return 'font-size:14px';
}

function renderBlock({ name, rows }) {
  const title = name
    ? `<tr><td data-section-title style="padding:16px 0 4px;font-size:11px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:${COLOUR.muted};border-top:1px solid ${COLOUR.rule}">${escapeHtml(name)}</td></tr>`
    : '';
  const lines = rows
    .map(
      (line) =>
        `<tr><td style="${rowStyle(name, line)};padding:2px 0">${colourWords(escapeHtml(line))}</td></tr>`,
    )
    .join('\n');
  return `${title}${lines}`;
}

/** The grey line under the band: what the sender could not find. Empty when all twelve are there. */
function notice(blocks) {
  const found = new Set(blocks.map((block) => block.name));
  const missing = SECTIONS.filter((name) => !found.has(name));
  if (missing.length === SECTIONS.length) return NOT_RECOGNISED;
  return missing.length ? `Sections not found: ${missing.join(', ')}.` : '';
}

/**
 * The band: its words are the subject after `MyClash ops · ` (`daily · 2 problem(s)`), its colour
 * comes from the subject's last part.
 */
function bandOf(subject) {
  const words = subject.replace(/^MyClash ops · /, '').trim();
  const ending = subject.split(' · ').at(-1).trim();
  if (/^all good$/i.test(ending)) return { words, colour: COLOUR.success };
  if (/^\d+ problems?(\(s\))?$/i.test(ending)) return { words, colour: COLOUR.danger };
  if (/^platform unreachable$/i.test(ending)) return { words, colour: COLOUR.dangerDark };
  return { words, colour: COLOUR.muted };
}

/** The whole HTML document. Every value is escaped before any markup is added around it. */
export function renderReportHtml(subject, text) {
  const { words, colour } = bandOf(subject);
  const blocks = splitSections(text);
  const missing = notice(blocks);
  const note = missing
    ? `<tr><td style="padding:12px 0 4px;font-size:12px;color:${COLOUR.muted}">${escapeHtml(missing)}</td></tr>`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px;font-family:sans-serif;color:${COLOUR.text}">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:100%;max-width:600px;margin:0 auto;border-collapse:collapse;font-size:14px;line-height:1.4">
<tr><td style="padding-bottom:12px;font-size:20px;font-weight:bold">MyClash <span style="color:${COLOUR.muted};font-weight:normal">· ops report</span></td></tr>
<tr><td data-band bgcolor="${colour}" style="background:${colour};color:#ffffff;padding:14px 16px;border-radius:6px;font-size:18px;font-weight:bold">${escapeHtml(words)}</td></tr>
${note}${blocks.map(renderBlock).join('\n')}
<tr><td style="padding-top:24px;font-size:12px;color:${COLOUR.muted};border-top:1px solid ${COLOUR.rule}">Sent by the MyClash ops agent. The plain-text part of this email holds the same report.</td></tr>
</table>
</body>
</html>`;
}
