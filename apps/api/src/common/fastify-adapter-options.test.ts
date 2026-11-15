import { errorCodes } from 'fastify';
import { describe, expect, it } from 'vitest';
import { logSafeError } from './fastify-adapter-options';

// Fastify's own error classes, built the way its router builds them (`new FST_ERR_…(path)`): if a
// Fastify update changes a refusal's message, these go red instead of a stand-in staying green.
describe('a refused address, as Fastify logs it (rulings 801-805)', () => {
  it.each([
    [
      'FST_ERR_BAD_URL',
      '/api/v1/event-passes/CODEMARK%FF?token=SECRETMARK',
      "'/api/v1/event-passes/[token]' is not a valid url component",
    ],
    [
      'FST_ERR_MAX_PARAM_LENGTH',
      `/api/v1/event-passes/${'CODEMARK'.repeat(15)}`,
      "'/api/v1/event-passes/[token]' is exceeding the max param length",
    ],
    [
      'FST_ERR_BAD_URL',
      "/api/v1/a'b%FF?token=SECRETMARK",
      "'/api/v1/[encoded]' is not a valid url component",
    ],
  ] as const)('%s quotes the address as a log may write it', (code, path, logged) => {
    const error = new errorCodes[code](path);
    const safe = logSafeError(error);
    expect(safe.message).toBe(logged);
    expect(safe.stack?.split('\n')[0]).toBe(`FastifyError: ${logged}`);
    expect(`${safe.message}${safe.stack}`).not.toMatch(/SECRETMARK|CODEMARK/u);
    // The same class (so the logged err.type stays FastifyError), code and status; the caller's
    // error, which answers them, is untouched.
    expect(Object.getPrototypeOf(safe)).toBe(Object.getPrototypeOf(error));
    expect(safe).toBeInstanceOf(URIError);
    expect(safe).toMatchObject({ name: 'FastifyError', code, statusCode: error.statusCode });
    expect(error.message).toContain(path);
  });

  it('any other error is logged as it is', () => {
    const notFound = new errorCodes.FST_ERR_NOT_FOUND();
    expect(logSafeError(notFound)).toBe(notFound);
    const plain = new Error('probe-marker');
    expect(logSafeError(plain)).toBe(plain);
  });
});
