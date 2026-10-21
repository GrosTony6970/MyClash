/**
 * Check 5 of `db-rls-probe.mjs`: every API_ONLY_WRITES table refuses the direct writes only the API
 * makes. Per entry and per verb of its own list, anon holds no grant for it, and the seeded
 * organisation admin, signed in, is refused it on PRIVILEGE ("permission denied for table"), not by
 * RLS: with the grant back and no write policy, an INSERT is still 42501 ("violates row-level
 * security") and an UPDATE or DELETE touches no row in silence. The INSERT copies the seeded row
 * under a new key from JSON read beforehand, so it reads nothing as the admin: SELECT is per column
 * since 0205.
 */
import { API_ONLY_WRITES } from './rls-probe-tables.mjs';
import { attempt } from './ruleset-pair-probe.mjs';

/** What is wrong, as sentences; none when all is right. Run it after the seed, in its transaction. */
export async function apiOnlyWritesFailures(tx) {
  const failures = [];
  for (const { table, key, row, verbs } of API_ONLY_WRITES) {
    const [seeded] =
      await tx`SELECT to_jsonb(t) AS doc FROM ${tx(table)} t WHERE ${tx(key)}::text = ${row}`;
    if (!seeded) {
      failures.push(`${table}: the seeded row ${row} is missing, so no write was tried`);
      continue;
    }
    const copy = JSON.stringify({ ...seeded.doc, [key]: globalThis.crypto.randomUUID() });
    const writes = {
      INSERT: (sp) =>
        sp`INSERT INTO ${sp(table)} SELECT * FROM jsonb_populate_record(NULL::${sp(table)}, ${copy}::text::jsonb)`,
      UPDATE: (sp) =>
        sp`UPDATE ${sp(table)} SET ${sp(key)} = ${sp(key)} WHERE ${sp(key)}::text = ${row}`,
      DELETE: (sp) => sp`DELETE FROM ${sp(table)} WHERE ${sp(key)}::text = ${row}`,
    };
    for (const verb of verbs ?? Object.keys(writes)) {
      const [anon] =
        await tx`SELECT has_table_privilege('anon', ${`public.${table}`}, ${verb}) AS granted`;
      if (anon.granted) failures.push(`anon holds ${verb} on ${table}: only the API writes it`);
      const failure = await attempt(tx, 'authenticated', writes[verb]);
      if (!failure)
        failures.push(`the organisation admin may ${verb} ${table}: only the API writes it`);
      else if (
        failure.code !== '42501' ||
        !failure.message.startsWith('permission denied for table')
      )
        failures.push(`${verb} on ${table} was not refused on privilege: ${failure.message}`);
    }
  }
  return failures;
}
