/**
 * Secrets that a shell script puts on a command line: the `-e` / `-v` / `env` shapes of 423a
 * (ruling 425).
 *
 * A command line is readable by every user of the machine (`ps`, /proc/<pid>/cmdline) for as long
 * as the command runs, and a container's processes are host processes. An environment is readable
 * only by its owner and root. So a secret travels in the environment and the command names it:
 * `-e NAME` (docker and compose take the value from their own environment),
 * `PGPASSWORD="$x" docker run -e PGPASSWORD …`, psql's `\getenv`.
 *
 * What it checks, over shell text:
 *   1. A `-e` / `--env` flag (docker, compose; glued `-eNAME=` too) or a `-v` / `--set` /
 *      `--variable` flag (psql) whose value expands something (a variable, `$( … )`, a backtick,
 *      a workflow's `${{ … }}`), when the flag's name or the expanded variable's name is
 *      secret-shaped; or whose secret-shaped name carries a placeholder (`=...`, `=<password>`),
 *      which is a help text inviting the operator to type the secret there.
 *      A literal value is allowed: a script in a public repo holds no real secret, only a
 *      throwaway like `-e POSTGRES_PASSWORD=postgres`.
 *   2. `env NAME=value cmd`: env is a program, so each assignment is judged the same way.
 *   3. A variable that holds generated secrets (ensure-prod-env's JSON) is expanded only as an
 *      environment prefix, `ENV_RESULT="$ENV_RESULT" node …`. Even a builtin such as `echo`,
 *      which exposes nothing, is a finding: one allowed shape is simpler to hold than a list of
 *      safe builtins.
 *
 * What it does NOT see, so a reviewer still has to: a secret in a header (`curl -H`), inside a
 * URL (`psql "postgres://u:$PW@…"`), as a positional argument, built into another variable first
 * (`A="PGPASSWORD=$S"; docker run -e "$A"`), split by a line continuation after `NAME=`,
 * after an `env` option that takes an argument (`env -u HOME KEY=$k`), or written by compose
 * into a healthcheck. It errs on the safe side by name: `MONKEY` is
 * secret-shaped, and `grep -v KEY=$x` is read as psql's `-v`.
 *
 * Comment lines are skipped: they may quote the pattern they forbid.
 */

const SECRET_NAME = /KEY|PASSWORD|PASSWD|SECRET|TOKEN|DATABASE_URL|DB_URI/i;

/** Variables whose value is a JSON document holding generated plaintext secrets. */
export const SECRET_RESULT_VARS = ['ENV_RESULT'];

// One value: a workflow expression or a command substitution (both may hold spaces), or any
// other non-space character.
const VALUE = String.raw`((?:\$\{\{[^}]*\}\}|\$\([^)]*\)|\S)*)`;
const FLAG = new RegExp(
  String.raw`(?:^|[\s(])(-e|--env|-v|--set|--variable)(?:\s+["']?|=["']?|(?<=-e)(?=[A-Za-z_]))([A-Za-z_][A-Za-z0-9_]*)=` +
    VALUE,
  'g',
);
const ENV_COMMAND = new RegExp(
  String.raw`(?:^|[\s(;|&])env((?:\s+-\S+)*(?:\s+["']?[A-Za-z_][A-Za-z0-9_]*=(?:\$\{\{[^}]*\}\}|\$\([^)]*\)|\S)*)+)`,
  'g',
);
const ASSIGNMENT = new RegExp(String.raw`(?:^|\s)["']?([A-Za-z_][A-Za-z0-9_]*)=` + VALUE, 'g');
// A shell expansion, a command substitution, or a workflow expression: GitHub writes
// `${{ secrets.X }}` into the command line before the shell runs it (and `secrets.` is
// secret-shaped: SECRET_NAME ignores case).
const EXPANSION = /\$\{\{\s*([A-Za-z_][\w.]*)|\$\{?([A-Za-z_][A-Za-z0-9_]*|[0-9])|\$\(()|`()/g;
const PLACEHOLDER = /^["']?(?:\.\.\.|<[^>]*>)/;

/** 'value' when the value hands a secret over, 'placeholder' for a typed-in example, or null. */
function judge(name, value) {
  const expanded = [...value.matchAll(EXPANSION)].map((m) => m[1] ?? m[2] ?? '');
  const secretName = SECRET_NAME.test(name);
  if (expanded.length > 0 && (secretName || expanded.some((v) => SECRET_NAME.test(v)))) {
    return 'value';
  }
  if (secretName && PLACEHOLDER.test(value)) return 'placeholder';
  return null;
}

function fromEnvironment(flag, name) {
  return flag === '-e' || flag === '--env'
    ? `pass it by name (-e ${name}) from the environment`
    : 'read it from the environment (psql \\getenv)';
}

function flagFindings(line) {
  const found = [];
  for (const [, flag, name, value] of line.matchAll(FLAG)) {
    const verdict = judge(name, value);
    if (verdict === 'value') {
      found.push(`${name} is given its value on the command line; ${fromEnvironment(flag, name)}`);
    } else if (verdict === 'placeholder') {
      found.push(`${name} is shown with a typed-in value; ${fromEnvironment(flag, name)}`);
    }
  }
  return found;
}

function envCommandFindings(line) {
  const found = [];
  for (const [, assignments] of line.matchAll(ENV_COMMAND)) {
    for (const [, name, value] of assignments.matchAll(ASSIGNMENT)) {
      if (judge(name, value)) {
        found.push(
          `${name} is given to env on its command line; set it as a prefix before the command (${name}="…" cmd)`,
        );
      }
    }
  }
  return found;
}

function resultVarFindings(line) {
  const found = [];
  for (const name of SECRET_RESULT_VARS) {
    const expansions = line.match(new RegExp(`\\$\\{?${name}\\b\\}?`, 'g')) ?? [];
    const prefixes =
      line.match(new RegExp(`(?:^|[\\s(])${name}="\\$\\{?${name}\\}?"\\s`, 'g')) ?? [];
    if (expansions.length > prefixes.length) {
      found.push(
        `$${name} holds generated secrets and is passed as an argument; pass it as ${name}="$${name}" before the command`,
      );
    }
  }
  return found;
}

/**
 * Findings in one shell file: `{ file, line, why }`, line 1-based.
 * @param {string} file the repo path, for the message
 * @param {string} text the file's text
 */
export function argvSecretFindings(file, text) {
  return text.split(/\r?\n/).flatMap((line, index) => {
    if (line.trimStart().startsWith('#')) return [];
    return [...flagFindings(line), ...envCommandFindings(line), ...resultVarFindings(line)].map(
      (why) => ({
        file,
        line: index + 1,
        why,
      }),
    );
  });
}
