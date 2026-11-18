/**
 * Whether a deploy script hands Compose its commit, or empties it first.
 *
 * deploy.sh, redeploy.sh and rollback.sh `export GIT_COMMIT` for Compose's
 * `${GIT_COMMIT:-unknown}`. They also load `.env` with `set -a`, and the
 * `.env` made from .env.example holds an empty `GIT_COMMIT=`: a load after the
 * export empties it. deploy.sh did that, and every container of a full deploy
 * said "unknown" (fixed in 1adb624d7).
 *
 * A load is `source` or `.` of `.env` (bare, `./`, quoted, or under a
 * variable such as `$ROOT_DIR/`), wherever a command may start on a line. A
 * call of a function of the same script whose body loads `.env` is a load too.
 * A load inside a file the script sources (`lib/*.sh`) is out of reach: none
 * loads `.env` today.
 */

const LOAD =
  /(?:^|[;&|{]|\bthen|\bdo|\belse)\s*(?:source|\.)\s+["']?(?:\$\{?\w+\}?\/|\.\/)?\.env["']?(?=[\s;&|)]|$)/m;
const EXPORT = /^\s*export\s+GIT_COMMIT\b/;
const FUNCTION_START = /^(\s*)(?:function\s+)?([A-Za-z_]\w*)\s*\(\)\s*\{?\s*$/;

/** The script's lines, with whole-line comments emptied (line numbers kept). */
const codeLines = (text) => text.split('\n').map((line) => (/^\s*#/.test(line) ? '' : line));

/**
 * The script's functions: name, first and last line. A function ends at the
 * first `}` at the indent of its opening line: rollback.sh writes one inside
 * an `if`, closed by an indented brace.
 */
function functionSpans(lines) {
  const spans = [];
  for (let i = 0; i < lines.length; i++) {
    const start = FUNCTION_START.exec(lines[i]);
    if (!start) continue;
    const close = new RegExp(`^${start[1]}\\}`);
    let end = i + 1;
    while (end < lines.length && !close.test(lines[end])) end++;
    spans.push({ name: start[2], start: i, end });
    i = end;
  }
  return spans;
}

/**
 * Why the script fails to hand Compose its commit, or null when it does: no
 * export, or a load of `.env` (directly, or through one of its functions) on a
 * line after the first export.
 */
export function gitCommitExportFinding(text) {
  const lines = codeLines(text);
  const exported = lines.findIndex((line) => EXPORT.test(line));
  if (exported === -1) return 'it never exports GIT_COMMIT for Compose';
  const spans = functionSpans(lines);
  const loaders = spans
    .filter(({ start, end }) => lines.slice(start + 1, end).some((line) => LOAD.test(line)))
    .map(({ name }) => name);
  const calls = loaders.length
    ? new RegExp(`(?:^|[;&|{]|\\bthen|\\bdo|\\belse)\\s*(?:${loaders.join('|')})\\b`)
    : null;
  const inFunction = (i) => spans.some(({ start, end }) => i >= start && i <= end);
  for (let i = exported + 1; i < lines.length; i++) {
    const line = lines[i];
    if (inFunction(i)) continue;
    if (LOAD.test(line) || calls?.test(line)) {
      return `line ${i + 1} loads .env after GIT_COMMIT is exported (line ${exported + 1}), which empties it`;
    }
  }
  return null;
}
