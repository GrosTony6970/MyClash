/**
 * What a FightBook log line may say about a failure it swallows. A message from elsewhere can name
 * an account: a queue error names the job id, which holds the account id
 * (`notification-scheduler.worker.ts`), and a database error can echo the values it was given. So a
 * line says our own words, or a database answer's code, or the error's kind: never a message we
 * did not write.
 */

/** An error whose message is our own words alone. Never put a value from elsewhere in it. */
export class OwnWordsError extends Error {
  override name = 'OwnWordsError';
}

/**
 * A database answer's code, never its message. A failed fetch has an empty code, and an answer
 * that is not JSON (a proxy's error page) has none, whatever supabase-js's type says.
 */
const databaseCode = (error: { code?: string }) => error.code || 'no code';

/** A read the database refused: `what` is a fixed phrase, the code is the database's. */
export const unreadable = (what: string, error: { code?: string }) =>
  new OwnWordsError(`${what} (${databaseCode(error)})`);

/** Our own words when the error is ours, else its kind. */
export const logReason = (cause: unknown): string =>
  cause instanceof OwnWordsError
    ? cause.message
    : cause instanceof Error
      ? cause.name
      : typeof cause;
