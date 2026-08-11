import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { QueryErrorRecorder } from './recorder';
import { createRecordingFetch } from './recording-fetch';

/**
 * Builds the Supabase clients with the swallowed-error tripwire installed.
 *
 * Lives here rather than in SupabaseService so that file stays about Supabase
 * access and this stays about diagnostics — and so the recursion guard below is
 * stated once, next to the code that depends on it.
 */

const CLIENT_OPTIONS = { auth: { persistSession: false, autoRefreshToken: false } } as const;

export interface InstrumentedClients {
  anon: SupabaseClient;
  service: SupabaseClient;
}

/**
 * Two instrumented clients, plus the un-instrumented one the recorder writes
 * through.
 *
 * THE THIRD CLIENT IS THE RECURSION GUARD. The recorder persists through a
 * client built WITHOUT the recording fetch; if its write were instrumented, a
 * database outage would trip the wire, which writes, which fails, which trips
 * the wire — a failure amplifier bolted onto every query in the API.
 */
export function createInstrumentedClients(
  url: string,
  anonKey: string,
  serviceKey: string,
): InstrumentedClients {
  const recorderClient = createClient(url, serviceKey, CLIENT_OPTIONS);

  const recordingFetch = createRecordingFetch(
    new QueryErrorRecorder(async (record) => {
      const { error } = await recorderClient.rpc('record_query_error', {
        p_fingerprint: record.fingerprint,
        p_method: record.method,
        p_table_name: record.table,
        p_is_rpc: record.isRpc,
        p_status: record.status,
        p_pg_code: record.code,
        p_severity: record.severity,
        p_sanitized_path: record.path,
        p_sanitized_message: record.message,
      });
      // The recorder catches and warn-logs this; it never reaches the query that
      // triggered it.
      if (error) throw new Error(error.message);
    }),
  );

  return {
    anon: createClient(url, anonKey, { ...CLIENT_OPTIONS, global: { fetch: recordingFetch } }),
    service: createClient(url, serviceKey, {
      ...CLIENT_OPTIONS,
      global: { fetch: recordingFetch },
    }),
  };
}
