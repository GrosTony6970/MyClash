/**
 * The three schema-security rules, as pure functions over migration SQL.
 *
 * ── Why they live here rather than in the gate ──────────────────────────────
 * check-db-review.mjs holds about twenty rules and sits against the 400-line
 * file cap once it is split into named functions. These three are the ones with
 * their own test, so moving them is what buys the gate room without touching
 * anything the test can see: check-db-review.mjs re-exports all three, so
 * scripts/check-db-review.test.mjs keeps importing them from the path it always
 * did and stays byte-identical.
 *
 * That test file is deliberately NOT duplicated here. Every other
 * scripts/lib/*.mjs has a sibling test, and this one does not, because its
 * coverage already exists one directory up and moving it would destroy the
 * regression proof it exists to be. scripts/check-db-review.gate.test.mjs
 * imports this module directly so it is still exercised under its own path.
 *
 * All three take SQL with comments already stripped — see ./sql.mjs. A table
 * named in prose is not a declaration, and 0184's header quotes the very
 * statement it explains.
 */

/** The bare object name: `public."events"` and `events` are the same table. */
export function objectName(matchValue) {
  return matchValue.split('.').pop()?.replaceAll('"', '') ?? matchValue;
}

// The IF NOT EXISTS clause is optional on purpose. Requiring it hid 17 table
// declarations from this check, and event_hidden_skills (0076) shipped
// world-readable for that reason alone — see 0184.
export function tablesMissingRls(sql) {
  const tables = [
    ...sql.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?((?:"?\w+"?\.)?"?\w+"?)/gi),
  ].map((match) => objectName(match[1] ?? ''));
  const enabled = [
    ...sql.matchAll(/ALTER TABLE\s+((?:"?\w+"?\.)?"?\w+"?)\s+ENABLE ROW LEVEL SECURITY/gi),
  ].map((match) => objectName(match[1] ?? ''));
  return [...new Set(tables.filter((table) => !enabled.includes(table)))];
}

// RLS does not apply to views. A view with security_invoker off runs as its
// OWNER, and the migrating role is supabase_admin (SUPERUSER, BYPASSRLS), so
// such a view hands its base tables to any role that may SELECT it with RLS
// switched off entirely. Matched corpus-wide: a view may be created in one
// migration and pinned in a later one.
export function viewsMissingSecurityInvoker(sql) {
  const views = [
    ...sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+((?:"?\w+"?\.)?"?\w+"?)/gi),
  ].map((match) => objectName(match[1] ?? ''));
  const pinned = [
    ...sql.matchAll(
      /ALTER\s+VIEW\s+((?:"?\w+"?\.)?"?\w+"?)\s+SET\s*\([^)]*security_invoker\s*=\s*on/gi,
    ),
    ...sql.matchAll(
      /CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+((?:"?\w+"?\.)?"?\w+"?)\s+WITH\s*\([^)]*security_invoker\s*=\s*on/gi,
    ),
  ].map((match) => objectName(match[1] ?? ''));
  return [...new Set(views.filter((view) => !pinned.includes(view)))];
}

// SECURITY DEFINER functions must be revoked from anon and authenticated BY
// NAME. `REVOKE ... FROM public` looks equivalent and is not: the supabase
// image's ALTER DEFAULT PRIVILEGES grants EXECUTE to those two roles by name,
// and a role-specific grant survives a revoke aimed at PUBLIC. 0156, 0180 and
// 0182 all shipped believing otherwise.
export function securityDefinerFunctionsReachableByAnon(sql) {
  // Bounded at the body marker so a plain function cannot borrow the SECURITY
  // DEFINER of whichever function happens to be declared after it.
  const definers = [
    ...sql.matchAll(
      /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+((?:"?\w+"?\.)?"?\w+"?)\s*\(([\s\S]*?)AS\s*\$/gi,
    ),
  ]
    .filter((match) => /\bSECURITY\s+DEFINER\b/i.test(match[2] ?? ''))
    .map((match) => objectName(match[1] ?? ''));
  const revoked = new Set();
  for (const match of sql.matchAll(
    /REVOKE\s+[\s\S]*?\bON\s+FUNCTION\s+([\s\S]*?)\bFROM\b([^;]*);/gi,
  )) {
    const roles = match[2] ?? '';
    if (!/\banon\b/iu.test(roles) || !/\bauthenticated\b/iu.test(roles)) continue;
    for (const target of (match[1] ?? '').matchAll(/((?:"?\w+"?\.)?"?\w+"?)\s*\(/g)) {
      revoked.add(objectName(target[1] ?? ''));
    }
  }
  return [...new Set(definers.filter((fn) => !revoked.has(fn)))];
}
