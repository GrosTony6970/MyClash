import { describe, expect, it } from 'vitest';
import { logSafeError } from './fastify-adapter-options';

/** A router refusal as fastify 5.12 builds it: its own error class, the whole address quoted. */
class FastifyError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'FastifyError';
  }
}

describe('a refused address, as Fastify logs it (rulings 801-805)', () => {
  it.each([
    [
      'FST_ERR_BAD_URL',
      "'/api/v1/event-passes/CODEMARK%FF?token=SECRETMARK' is not a valid url component",
      "'/api/v1/event-passes/[token]' is not a valid url component",
    ],
    [
      'FST_ERR_MAX_PARAM_LENGTH',
      `'/api/v1/event-passes/${'CODEMARK'.repeat(15)}' is exceeding the max param length`,
      "'/api/v1/event-passes/[token]' is exceeding the max param length",
    ],
    [
      'FST_ERR_BAD_URL',
      "'/api/v1/a'b%FF?token=SECRETMARK' is not a valid url component",
      "'/api/v1/[encoded]' is not a valid url component",
    ],
  ])('%s quotes the address as a log may write it', (code, message, logged) => {
    const error = new FastifyError(code, message);
    const safe = logSafeError(error);
    expect(safe.message).toBe(logged);
    expect(safe.stack?.split('\n')[0]).toBe(`FastifyError: ${logged}`);
    expect(`${safe.message}${safe.stack}`).not.toMatch(/SECRETMARK|CODEMARK/u);
    // The same class, so the logged err.type stays FastifyError; the caller's error is untouched.
    expect(safe).toBeInstanceOf(FastifyError);
    expect(safe).toMatchObject({ name: 'FastifyError', code });
    expect(error.message).toBe(message);
  });

  it('any other error is logged as it is', () => {
    const error = new FastifyError(
      'FST_ERR_NOT_FOUND',
      "'/x?token=1' is not a valid url component",
    );
    expect(logSafeError(error)).toBe(error);
    const plain = new Error('probe-marker');
    expect(logSafeError(plain)).toBe(plain);
  });
});
