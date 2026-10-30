import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { buildCorsOrigins } from '../security/http-security';
import { ApiExceptionFilter, type ApiExceptionReporter } from './api-exception.filter';
import { API_GLOBAL_PREFIX, API_GLOBAL_PREFIX_EXCLUDE } from './global-prefix';
import { multipartMaxBytes } from './multipart-limit';
import { ZodOrClassValidationPipe } from './zod-or-class-validation.pipe';

type FastifyPlugin = Parameters<NestFastifyApplication['register']>[0];

function cookieSecret(): string {
  return process.env['COOKIE_SECRET'] ?? 'dev-cookie-secret-change-in-prod';
}

/**
 * Everything the API does to its HTTP app between creating it and listening: the cookie and
 * multipart plugins, the global pipe and filter, the global prefix, CORS.
 *
 * One owner. `main.ts` calls it, and the edge tests (`http-edge*.http.test.ts`) call it on their
 * own small app, so what they pin is what production runs. The `FastifyAdapter` itself stays in
 * `main.ts`, where `trust-proxy.test.ts` reads its options.
 */
export async function configureHttpApp(
  app: NestFastifyApplication,
  { reportException }: { reportException: ApiExceptionReporter },
): Promise<void> {
  // Both plugins are loaded with require(), not import: see docs/ENGINEERING_LESSONS.md
  // ("@fastify/cookie must be registered via require()").
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fastifyCookie = require('@fastify/cookie') as { default: FastifyPlugin };
  await app.register(fastifyCookie.default ?? fastifyCookie, { secret: cookieSecret() });

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fastifyMultipart = require('@fastify/multipart') as { default: FastifyPlugin };
  await app.register(fastifyMultipart.default ?? fastifyMultipart, {
    limits: { fileSize: multipartMaxBytes() },
  });

  app.useGlobalPipes(
    new ZodOrClassValidationPipe({
      whitelist: true, // strip unknown properties (class-validator DTOs)
      forbidNonWhitelisted: true,
      transform: true, // auto-transform payloads to DTO instances
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter(reportException));

  // Shared with scripts/emit-openapi.cjs so the served routes and the generated client can't
  // disagree — see global-prefix.ts.
  app.setGlobalPrefix(API_GLOBAL_PREFIX, { exclude: API_GLOBAL_PREFIX_EXCLUDE });

  const domain = process.env['DOMAIN'] ?? 'myclash.localhost';
  app.enableCors({ origin: buildCorsOrigins(domain), credentials: true });
}
