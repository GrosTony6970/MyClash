import { describe, expect, it } from 'vitest';
import {
  REDACTED,
  REDACTED_EMAIL,
  isSensitiveRoute,
  redactHeaders,
  redactValue,
} from './redaction';

describe('observability redaction', () => {
  it('redacts emails, bearer tokens, JWTs, and secret-like keys', () => {
    const redacted = redactValue({
      email: 'fighter@example.com',
      note: 'Contact fighter@example.com with Bearer abc.def.ghi',
      authorization: 'Bearer secret-token',
      nested: {
        apiKey: 'sk-test',
        token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature',
      },
    });

    expect(redacted).toEqual({
      email: REDACTED,
      note: `Contact ${REDACTED_EMAIL} with Bearer ${REDACTED}`,
      authorization: REDACTED,
      nested: {
        apiKey: REDACTED,
        token: REDACTED,
      },
    });
  });

  it('redacts authorization and cookie headers', () => {
    expect(
      redactHeaders({
        authorization: 'Bearer abc',
        cookie: 'sb-access-token=abc',
        'x-request-id': 'req-1',
      }),
    ).toEqual({
      authorization: REDACTED,
      cookie: REDACTED,
      'x-request-id': 'req-1',
    });
  });

  it('classifies auth, upload, AI, and query routes as sensitive', () => {
    expect(isSensitiveRoute('/api/v1/auth/magic-link')).toBe(true);
    expect(isSensitiveRoute('/api/v1/events/e1/import')).toBe(true);
    expect(isSensitiveRoute('/api/v1/tournaments/t1/query')).toBe(true);
    expect(isSensitiveRoute('/api/v1/events/e1/ai-usage')).toBe(true);
    expect(isSensitiveRoute('/api/v1/events/e1')).toBe(false);
  });
});
