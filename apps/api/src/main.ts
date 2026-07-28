import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/api-exception.filter';
import { API_GLOBAL_PREFIX, API_GLOBAL_PREFIX_EXCLUDE } from './common/global-prefix';
import { captureApiException, initApiSentry } from './common/observability/sentry';
import { registerProcessFailureHandlers } from './common/process-failure-handlers';
import { ZodOrClassValidationPipe } from './common/zod-or-class-validation.pipe';
import { buildCorsOrigins } from './security/http-security';

const PORT = process.env['PORT'] ? Number(process.env['PORT']) : 4000;

initApiSentry();
registerProcessFailureHandlers(undefined, (reason, context) =>
  captureApiException(reason, context),
);

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: process.env['NODE_ENV'] !== 'test',
      // Traefik is the only hop in front of us, so trust exactly one: `req.ip`
      // then resolves to the last X-Forwarded-For entry — the address Traefik
      // itself observed. Without this, `req.ip` is Traefik's container address
      // and every client shares a single rate-limit bucket. The hop count (not
      // `true`) is what makes it spoof-proof: a client-supplied X-Forwarded-For
      // only ever prepends to the chain, so it can't displace the real address.
      trustProxy: 1,
    }),
  );

  // ── Cookie support ───────────────────────────────────────────────────────
  // Register @fastify/cookie via the underlying Fastify instance
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fastifyCookie = require('@fastify/cookie') as {
    default: Parameters<NestFastifyApplication['register']>[0];
  };
  await app.register(fastifyCookie.default ?? fastifyCookie, {
    secret: process.env['COOKIE_SECRET'] ?? 'dev-cookie-secret-change-in-prod',
  });

  // ── Multipart (file uploads) ─────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fastifyMultipart = require('@fastify/multipart') as {
    default: Parameters<NestFastifyApplication['register']>[0];
  };
  const multipartMaxBytes = process.env['MULTIPART_MAX_BYTES']
    ? Number(process.env['MULTIPART_MAX_BYTES'])
    : 1024 * 1024 * 1024;
  await app.register(fastifyMultipart.default ?? fastifyMultipart, {
    limits: { fileSize: multipartMaxBytes },
  });

  // ── Global validation pipe ───────────────────────────────────────────────
  app.useGlobalPipes(
    new ZodOrClassValidationPipe({
      whitelist: true, // strip unknown properties (class-validator DTOs)
      forbidNonWhitelisted: true,
      transform: true, // auto-transform payloads to DTO instances
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter(captureApiException));

  // ── Global prefix ────────────────────────────────────────────────────────
  // Shared with scripts/emit-openapi.cjs so the served routes and the generated
  // client can't disagree — see common/global-prefix.ts.
  app.setGlobalPrefix(API_GLOBAL_PREFIX, { exclude: API_GLOBAL_PREFIX_EXCLUDE });

  // ── CORS ─────────────────────────────────────────────────────────────────
  const domain = process.env['DOMAIN'] ?? 'myclash.localhost';
  app.enableCors({
    origin: buildCorsOrigins(domain),
    credentials: true,
  });

  // ── OpenAPI / Swagger (dev only) ─────────────────────────────────────────
  if (process.env['NODE_ENV'] !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('MyClash API')
      .setDescription('Free, open-source platform for HEMA event management — REST API')
      .setVersion('1.0')
      .addBearerAuth()
      .addCookieAuth('sb-access-token')
      .build();

    const document = cleanupOpenApiDoc(SwaggerModule.createDocument(app, config));
    SwaggerModule.setup('api/docs', app, document);
  }

  await app.listen(PORT, '0.0.0.0');
  console.info(`MyClash API listening on http://0.0.0.0:${PORT}`);
  console.info(`Swagger UI: http://localhost:${PORT}/api/docs`);
}

void bootstrap();
