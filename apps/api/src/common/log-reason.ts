/**
 * What a log line may say about a failure it swallows. A message from elsewhere can name a person:
 * a queue error names the job id, which can hold the account id
 * (`notification-scheduler.worker.ts`), and a database error can echo the values it was given. So
 * a line says our own words, or a database answer's code in words, or the error's kind: never a
 * message we did not write.
 */

/** An error whose message is our own words alone. Never put a value from elsewhere in it. */
export class OwnWordsError extends Error {
  override name = 'OwnWordsError';
}

// Postgres's own condition names (its manual, appendix "PostgreSQL Error Codes"): the exact name of
// the codes we meet, and the name of every code family (the code's first two characters).
const POSTGRES_CODES: Readonly<Record<string, string>> = {
  '08006': 'connection_failure',
  '22001': 'string_data_right_truncation',
  '22003': 'numeric_value_out_of_range',
  '22007': 'invalid_datetime_format',
  '22P02': 'invalid_text_representation',
  '23502': 'not_null_violation',
  '23503': 'foreign_key_violation',
  '23505': 'unique_violation',
  '23514': 'check_violation',
  '23P01': 'exclusion_violation',
  '25006': 'read_only_sql_transaction',
  '40001': 'serialization_failure',
  '40P01': 'deadlock_detected',
  '42501': 'insufficient_privilege',
  '42703': 'undefined_column',
  '42883': 'undefined_function',
  '42P01': 'undefined_table',
  '53100': 'disk_full',
  '53200': 'out_of_memory',
  '53300': 'too_many_connections',
  '55P03': 'lock_not_available',
  '57014': 'query_canceled',
  '57P01': 'admin_shutdown',
  '57P03': 'cannot_connect_now',
  P0001: 'raise_exception',
  P0002: 'no_data_found',
  XX001: 'data_corrupted',
};

const POSTGRES_FAMILIES: Readonly<Record<string, string>> = {
  '01': 'warning',
  '02': 'no_data',
  '03': 'sql_statement_not_yet_complete',
  '08': 'connection_exception',
  '09': 'triggered_action_exception',
  '0A': 'feature_not_supported',
  '0B': 'invalid_transaction_initiation',
  '0F': 'locator_exception',
  '0L': 'invalid_grantor',
  '0P': 'invalid_role_specification',
  '0Z': 'diagnostics_exception',
  '20': 'case_not_found',
  '21': 'cardinality_violation',
  '22': 'data_exception',
  '23': 'integrity_constraint_violation',
  '24': 'invalid_cursor_state',
  '25': 'invalid_transaction_state',
  '26': 'invalid_sql_statement_name',
  '27': 'triggered_data_change_violation',
  '28': 'invalid_authorization_specification',
  '2B': 'dependent_privilege_descriptors_still_exist',
  '2D': 'invalid_transaction_termination',
  '2F': 'sql_routine_exception',
  '34': 'invalid_cursor_name',
  '38': 'external_routine_exception',
  '39': 'external_routine_invocation_exception',
  '3B': 'savepoint_exception',
  '3D': 'invalid_catalog_name',
  '3F': 'invalid_schema_name',
  '40': 'transaction_rollback',
  '42': 'syntax_error_or_access_rule_violation',
  '44': 'with_check_option_violation',
  '53': 'insufficient_resources',
  '54': 'program_limit_exceeded',
  '55': 'object_not_in_prerequisite_state',
  '57': 'operator_intervention',
  '58': 'system_error',
  '72': 'snapshot_too_old',
  F0: 'config_file_error',
  HV: 'fdw_error',
  P0: 'plpgsql_error',
  XX: 'internal_error',
};

// PostgREST's codes (`PGRST` + group + number): our names for the ones we meet, and for each group.
const POSTGREST_CODES: Readonly<Record<string, string>> = {
  PGRST116: 'not_exactly_one_row',
  PGRST202: 'unknown_function',
  PGRST204: 'unknown_column',
  PGRST205: 'unknown_table',
};

const POSTGREST_GROUPS: Readonly<Record<string, string>> = {
  '0': 'postgrest_connection_error',
  '1': 'postgrest_request_error',
  '2': 'postgrest_schema_cache_error',
  '3': 'postgrest_jwt_error',
  X: 'postgrest_internal_error',
};

function codeName(code: string): string | undefined {
  if (code.startsWith('PGRST')) return POSTGREST_CODES[code] ?? POSTGREST_GROUPS[code.charAt(5)];
  return POSTGRES_CODES[code] ?? POSTGRES_FAMILIES[code.slice(0, 2)];
}

/**
 * A database answer's code in words, never its message: `unique_violation (23505)`, the bare code
 * when it has no known name. A failed fetch has an empty code, and an answer that is not JSON (a
 * proxy's error page) has none, whatever supabase-js's type says: both are `no code`.
 */
export function databaseReason(error: { code?: string }): string {
  if (!error.code) return 'no code';
  const name = codeName(error.code);
  return name ? `${name} (${error.code})` : error.code;
}

/** A read the database refused: `what` is a fixed phrase, the rest is `databaseReason`. */
export const unreadable = (what: string, error: { code?: string }) =>
  new OwnWordsError(`${what}: ${databaseReason(error)}`);

/** Our own words when the error is ours, else its kind. */
export const logReason = (cause: unknown): string =>
  cause instanceof OwnWordsError
    ? cause.message
    : cause instanceof Error
      ? cause.name
      : typeof cause;
