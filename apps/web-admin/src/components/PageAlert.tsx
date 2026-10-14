/**
 * What the last action of a page came to: a refusal, or a success. ONE value,
 * so a new answer replaces the old one and a success never sits beside an
 * older refusal. A grey line for both (quick win O4) left the organiser unable
 * to tell whether the hall was told.
 */
export interface Outcome {
  tone: 'error' | 'success';
  text: string;
}

export const errorOutcome = (text: string): Outcome => ({ tone: 'error', text });
export const successOutcome = (text: string): Outcome => ({ tone: 'success', text });

/** A refusal is an alert a screen reader reads at once; a success is a status. */
export function PageAlert({
  outcome,
  className = '',
}: {
  outcome: Outcome | null;
  className?: string;
}) {
  if (!outcome) return null;
  const error = outcome.tone === 'error';
  return (
    <p
      role={error ? 'alert' : 'status'}
      className={`rounded-md border px-4 py-3 text-sm ${
        error
          ? 'border-danger/30 bg-danger/10 text-danger'
          : 'border-success/30 bg-success/10 text-success'
      } ${className}`}
    >
      {outcome.text}
    </p>
  );
}
