import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { buildCorsOrigins } from './security/http-security';

const PORT = process.env['PORT'] ? Number(process.env['PORT']) : 4000;

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: process.env['NODE_ENV'] !== 'test' }),
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
    new ValidationPipe({
      whitelist: true, // strip unknown properties
      forbidNonWhitelisted: true,
      transform: true, // auto-transform payloads to DTO instances
    }),
  );

  // ── Global prefix ────────────────────────────────────────────────────────
  app.setGlobalPrefix('api/v1', {
    // Health and version endpoints live at /health and /version (no prefix)
    exclude: ['health', 'version'],
  });

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

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  await app.listen(PORT, '0.0.0.0');
  console.info(`MyClash API listening on http://0.0.0.0:${PORT}`);
  console.info(`Swagger UI: http://localhost:${PORT}/api/docs`);
}

void bootstrap();
