/**
 * db:review's SECURITY DEFINER rule: a definer function must be closed to PUBLIC AND to anon and
 * authenticated by name. Either alone leaves a door: before 0275 every new function gave PUBLIC
 * EXECUTE (Postgres's built-in default) and the Supabase image granted the two roles by name, a
 * grant a revoke aimed at PUBLIC does not remove. 0275 closes new functions by default, but an
 * older function, one owned by another role, or one made in a schema whose defaults name the web
 * roles may still carry them, so a definer names all three. 0156, 0180 and 0182 first shipped with
 * the by-name hole; the PUBLIC one was accepted here until ruling 826.
 *
 * The corpus is read IN ORDER, statement by statement, as Postgres applies it: a statement ends at
 * a `;` outside quotes and dollar quotes, and quoted text (bodies, defaults, comments in strings)
 * is blanked before anything is matched. A function is keyed by schema, name (unquoted parts
 * folded to lower case) and number of input arguments. CREATE makes it (OR REPLACE of an existing
 * one keeps its grants, as Postgres does), DROP (or DROP SCHEMA) forgets it, ALTER ... SECURITY
 * sets its kind, ALTER ... RENAME TO / SET SCHEMA moves it, and each REVOKE or GRANT of EXECUTE
 * (on one function, or ON ALL ... IN SCHEMA) closes or reopens it per role. The revokes may sit in
 * other statements and migrations (0156+0184, 0180+0184, 0182+0184). A quote with no closer throws:
 * it would blank the rest of the corpus and hide every later statement.
 *
 * What it cannot see. Toward a false red: two overloads with the same number of input arguments
 * are one. Toward a false green: a function created, granted or revoked inside a DO block or by
 * `execute format(...)` (quoted text, so blanked); a BEGIN ATOMIC body with several statements, cut
 * at its first `;` (none in this repo). The RLS probe's check 24 reads the live grants of every
 * function in `public`.
 */

const WEB = ['public', 'anon', 'authenticated'];
const DOLLAR = /\$(?:[A-Za-z_]\w*)?\$/y;

const unclosed = (i) => {
  throw new Error(`definer rule: a quote opened at offset ${i} never closes`);
};

/** The index just past the quoted span (a string or a dollar-quoted body) at `i`, or -1. */
function quotedEnd(sql, i) {
  if (sql[i] === "'") {
    const escapes = /[eE]/.test(sql[i - 1] ?? '') && !/\w/.test(sql[i - 2] ?? '');
    for (let j = i + 1; j < sql.length; j += 1) {
      if (escapes && sql[j] === '\\') j += 1;
      else if (sql[j] === "'" && sql[j + 1] === "'") j += 1;
      else if (sql[j] === "'") return j + 1;
    }
    return unclosed(i);
  }
  // `$` inside an identifier (`a$b`) or a positional parameter (`$1`) opens nothing.
  DOLLAR.lastIndex = i;
  const tag = sql[i] === '$' && !/[\w$]/.test(sql[i - 1] ?? '') ? DOLLAR.exec(sql) : null;
  if (!tag) return -1;
  const close = sql.indexOf(tag[0], i + tag[0].length);
  return close < 0 ? unclosed(i) : close + tag[0].length;
}

/** The statements of `sql` (comments already stripped), quoted spans blanked, trimmed. */
export function blankedStatements(sql) {
  const out = [];
  let current = '';
  for (let i = 0; i < sql.length; i += 1) {
    const end = quotedEnd(sql, i);
    if (sql[i] === '"') {
      // A quoted identifier is kept (it is a name), and a `'` inside it opens nothing.
      const close = sql.indexOf('"', i + 1);
      if (close < 0) unclosed(i);
      current += sql.slice(i, close + 1);
      i = close;
    } else if (end > 0) {
      current += ' '.repeat(end - i);
      i = end - 1;
    } else if (sql[i] === ';') {
      out.push(current.trim());
      current = '';
    } else current += sql[i];
  }
  out.push(current.trim());
  return out.filter((statement) => statement !== '');
}

/** `text` split on commas outside parentheses. */
function splitTop(text) {
  const parts = [''];
  let depth = 0;
  for (const c of text) {
    if (c === '(') depth += 1;
    if (c === ')') depth -= 1;
    if (c === ',' && depth === 0) parts.push('');
    else parts[parts.length - 1] += c;
  }
  return parts;
}

/** `schema.name`, unquoted parts folded to lower case, `public` when no schema is named. */
function qualified(raw) {
  const parts = raw
    .split(/\s*\.\s*/)
    .map((p) => (p.startsWith('"') ? p.slice(1, -1) : p.toLowerCase()));
  return parts.length === 1 ? `public.${parts[0]}` : parts.join('.');
}

const IDENT = String.raw`(?:"[^"]+"|[A-Za-z_][\w$]*)(?:\s*\.\s*(?:"[^"]+"|[A-Za-z_][\w$]*))?`;

/** One `name` or `name(args)`: its qualified name and its key (`*` when no arguments are given). */
function target(item) {
  const match = new RegExp(String.raw`^\s*(${IDENT})\s*(?:\(([\s\S]*)\))?\s*$`).exec(item);
  if (!match) return null;
  const qn = qualified(match[1] ?? '');
  if (match[2] === undefined) return { qn, key: `${qn}/*` };
  const inputs = splitTop(match[2]).filter((a) => a.trim() !== '' && !/^\s*out\s/i.test(a));
  return { qn, key: `${qn}/${inputs.length}` };
}

/** The `name(args)` at the start of `text`, and the rest of `text` after its closing `)`. */
function leading(text) {
  const match = new RegExp(String.raw`^\s*(${IDENT})\s*\(`).exec(text);
  if (!match) return null;
  let depth = 0;
  for (let i = match[0].length - 1; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    if (text[i] === ')' && --depth === 0) {
      return { found: target(text.slice(0, i + 1)), rest: text.slice(i + 1) };
    }
  }
  return null;
}

/** The functions a statement names: every one of a name given with no arguments. */
function keysOf(fns, found) {
  if (!found) return [];
  if (!found.key.endsWith('/*')) return [found.key];
  return [...fns.keys()].filter((key) => key.startsWith(`${found.qn}/`));
}

function onCreate(fns, statement, head) {
  const parsed = leading(statement.slice(head.length));
  if (!parsed?.found) return;
  const known = fns.get(parsed.found.key);
  fns.set(parsed.found.key, {
    name: parsed.found.qn.split('.').pop(),
    definer: /\bSECURITY\s+DEFINER\b/i.test(parsed.rest),
    closed: known && /\bOR\s+REPLACE\b/i.test(head) ? known.closed : new Set(),
  });
}

function onDrop(fns, list) {
  for (const item of splitTop(list.replace(/\s+(?:CASCADE|RESTRICT)\s*$/i, ''))) {
    for (const key of keysOf(fns, target(item))) fns.delete(key);
  }
}

/** The key `key` would have under the qualified name `qn` (its argument count kept). */
const rekeyed = (key, qn) => `${qn}${key.slice(key.lastIndexOf('/'))}`;

function onAlter(fns, rest) {
  const parsed = leading(rest);
  const found = parsed?.found ?? target(rest.split(/\s/).find(Boolean) ?? '');
  const tail = parsed ? parsed.rest : rest;
  const kind = /\bSECURITY\s+(DEFINER|INVOKER)\b/i.exec(tail);
  const renamed = /^\s*RENAME\s+TO\s+("[^"]+"|\w+)\s*$/i.exec(tail);
  const moved = /^\s*SET\s+SCHEMA\s+("[^"]+"|\w+)\s*$/i.exec(tail);
  for (const key of keysOf(fns, found)) {
    const fn = fns.get(key);
    if (!fn || !found) continue;
    if (kind) fn.definer = kind[1]?.toUpperCase() === 'DEFINER';
    const schema = found.qn.slice(0, found.qn.indexOf('.'));
    const qn = renamed
      ? qualified(`${schema}.${renamed[1]}`)
      : moved && qualified(`${moved[1]}.${found.qn.split('.').pop()}`);
    if (!qn) continue;
    fns.delete(key);
    fns.set(rekeyed(key, qn), { ...fn, name: qn.split('.').pop() });
  }
}

function onDropSchema(fns, list) {
  for (const raw of splitTop(list.replace(/\s+(?:CASCADE|RESTRICT)\s*$/i, ''))) {
    const name = raw.trim().startsWith('"') ? raw.trim().slice(1, -1) : raw.trim().toLowerCase();
    for (const key of [...fns.keys()]) if (key.startsWith(`${name}.`)) fns.delete(key);
  }
}

const PRIVILEGE = new RegExp(
  String.raw`^(REVOKE|GRANT)\s+([\s\S]*?)\s+ON\s+(?:ALL\s+(?:FUNCTIONS|ROUTINES|PROCEDURES)\s+IN\s+SCHEMA\s+([\s\S]*?)|(?:FUNCTION|ROUTINE|PROCEDURE)\s+([\s\S]*?))\s+(?:FROM|TO)\s+([\s\S]*)$`,
  'i',
);

function onPrivilege(fns, match) {
  const [, verb = '', privileges = '', schemas, list = '', grantees = ''] = match;
  if (/^GRANT\s+OPTION\s+FOR\b/i.test(privileges)) return;
  if (!/\b(EXECUTE|ALL)\b/i.test(privileges)) return;
  const roles = grantees.split(/[\s,]+/).map((r) => r.replaceAll('"', '').toLowerCase());
  const keys =
    schemas === undefined
      ? splitTop(list).flatMap((item) => keysOf(fns, target(item)))
      : splitTop(schemas).flatMap((schema) => {
          const raw = schema.trim();
          const name = raw.startsWith('"') ? raw.slice(1, -1) : raw.toLowerCase();
          return [...fns.keys()].filter((key) => key.startsWith(`${name}.`));
        });
  for (const key of keys) {
    const fn = fns.get(key);
    for (const role of WEB.filter((r) => fn && roles.includes(r))) {
      if (verb.toUpperCase() === 'REVOKE') fn?.closed.add(role);
      else fn?.closed.delete(role);
    }
  }
}

export function securityDefinerFunctionsReachableByAnon(sql) {
  const fns = new Map();
  for (const statement of blankedStatements(sql)) {
    const create = /^CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+/i.exec(statement);
    const drop = /^DROP\s+(?:FUNCTION|PROCEDURE|ROUTINE)\s+(?:IF\s+EXISTS\s+)?([\s\S]*)$/i.exec(
      statement,
    );
    const alter = /^ALTER\s+(?:FUNCTION|PROCEDURE|ROUTINE)\s+([\s\S]*)$/i.exec(statement);
    const dropSchema = /^DROP\s+SCHEMA\s+(?:IF\s+EXISTS\s+)?([\s\S]*)$/i.exec(statement);
    const privilege = PRIVILEGE.exec(statement);
    if (create) onCreate(fns, statement, create[0]);
    else if (drop) onDrop(fns, drop[1] ?? '');
    else if (dropSchema) onDropSchema(fns, dropSchema[1] ?? '');
    else if (alter) onAlter(fns, alter[1] ?? '');
    else if (privilege) onPrivilege(fns, privilege);
  }
  const open = [...fns.values()].filter((fn) => fn.definer && WEB.some((r) => !fn.closed.has(r)));
  return [...new Set(open.map((fn) => fn.name))];
}
