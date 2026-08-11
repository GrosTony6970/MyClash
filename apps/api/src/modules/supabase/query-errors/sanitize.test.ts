import { describe, expect, it } from 'vitest';
import { sanitizeMessage, sanitizeRequest } from './sanitize';

/**
 * These assertions carry two guarantees at once: hard rule 7 (no personal data
 * stored, in a public repo's product) and the bounded growth the aggregated
 * store depends on. A value that survives sanitisation both leaks and mints a
 * fresh fingerprint per distinct value, so "no PII" and "one row per defect"
 * are the same test.
 */

const EMAIL = 'someone@example.com';
const UUID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const NAME = 'Jean Dupont';

function leaks(value: string): (candidate: string | null) => boolean {
  return (candidate) => (candidate ?? '').includes(value);
}

describe('sanitizeRequest', () => {
  it('keeps the table and the operator, drops the value', () => {
    const result = sanitizeRequest(`https://app.myclash.fr/rest/v1/persons?email=eq.${EMAIL}`);

    expect(result?.table).toBe('persons');
    expect(result?.isRpc).toBe(false);
    expect(result?.path).toBe('persons?email=eq.<redacted>');
    expect(leaks(EMAIL)(result?.path ?? '')).toBe(false);
  });

  it('keeps select lists whole — they are structure, and the diagnostic', () => {
    const result = sanitizeRequest(
      'https://app.myclash.fr/rest/v1/matches?select=id,phases!inner(tournament_id)&id=eq.7',
    );

    expect(result?.path).toContain('select=id,phases!inner(tournament_id)');
    expect(result?.path).toContain('id=eq.<redacted>');
  });

  /**
   * The case a `param=op.value` grammar misses. This repo builds `or=` filters
   * on its search paths, so a searched fighter's name rides inside a compound.
   */
  it('redacts every member of an or= compound', () => {
    const result = sanitizeRequest(
      `https://app.myclash.fr/rest/v1/persons?or=(full_name.ilike.*${NAME}*,email.eq.${EMAIL})`,
    );

    expect(result?.path).toBe('persons?or=(full_name.ilike.<redacted>,email.eq.<redacted>)');
    expect(leaks(NAME)(result?.path ?? '')).toBe(false);
    expect(leaks(EMAIL)(result?.path ?? '')).toBe(false);
  });

  it('redacts a not.eq. filter without losing the negation', () => {
    const result = sanitizeRequest(`https://app.myclash.fr/rest/v1/persons?id=not.eq.${UUID}`);

    expect(result?.path).toBe('persons?id=not.eq.<redacted>');
    expect(leaks(UUID)(result?.path ?? '')).toBe(false);
  });

  it('redacts an in.() list', () => {
    const result = sanitizeRequest(
      `https://app.myclash.fr/rest/v1/persons?id=in.(${UUID},${UUID})`,
    );

    expect(leaks(UUID)(result?.path ?? '')).toBe(false);
  });

  it('names the function for an rpc call', () => {
    const result = sanitizeRequest('https://app.myclash.fr/rest/v1/rpc/record_query_error');

    expect(result?.table).toBe('record_query_error');
    expect(result?.isRpc).toBe(true);
    expect(result?.path).toBe('rpc/record_query_error');
  });

  it.each([
    ['GoTrue', 'https://app.myclash.fr/auth/v1/user'],
    ['Storage', 'https://app.myclash.fr/storage/v1/bucket/club-logos'],
    ['Functions', 'https://app.myclash.fr/functions/v1/whatever'],
    ['not a URL', 'nonsense'],
  ])('returns null for %s — out of scope for the tripwire', (_label, url) => {
    expect(sanitizeRequest(url)).toBeNull();
  });

  /**
   * The bound the whole store rests on: two different values for the same
   * broken query must produce the SAME sanitised path, so they fold into one
   * fingerprint instead of one row each.
   */
  it('renders two different values identically', () => {
    const a = sanitizeRequest('https://app.myclash.fr/rest/v1/persons?email=eq.a@x.com');
    const b = sanitizeRequest('https://app.myclash.fr/rest/v1/persons?email=eq.b@y.com');

    expect(a?.path).toBe(b?.path);
  });
});

describe('sanitizeMessage', () => {
  it('redacts the value in a unique-violation body, keeping the column', () => {
    const message = sanitizeMessage(
      `duplicate key value violates unique constraint "persons_event_id_email_key" Key (email)=(${EMAIL}) already exists.`,
    );

    expect(message).toContain('persons_event_id_email_key');
    expect(message).toContain('Key (email)=(<redacted>)');
    expect(leaks(EMAIL)(message)).toBe(false);
  });

  it('redacts every group in a composite key', () => {
    const message = sanitizeMessage(`Key (event_id, email)=(${UUID}, ${EMAIL}) already exists.`);

    expect(leaks(UUID)(message)).toBe(false);
    expect(leaks(EMAIL)(message)).toBe(false);
    expect(message).toContain('Key (event_id, email)=(<redacted>)');
  });

  it('leaves a value-free message untouched', () => {
    const message = sanitizeMessage(
      "Could not find a relationship between 'matches' and 'tournaments' in the schema cache",
    );

    expect(message).toBe(
      "Could not find a relationship between 'matches' and 'tournaments' in the schema cache",
    );
  });

  it('folds two different colliding values into one message', () => {
    const a = sanitizeMessage(`Key (email)=(a@x.com) already exists.`);
    const b = sanitizeMessage(`Key (email)=(b@y.com) already exists.`);

    expect(a).toBe(b);
  });

  it.each([null, undefined, ''])('returns null for %s', (value) => {
    expect(sanitizeMessage(value)).toBeNull();
  });
});
