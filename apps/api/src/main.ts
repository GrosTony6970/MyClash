import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { AppModule } from './app.module';
import { fastifyAdapterOptions } from './common/fastify-adapter-options';
import { configureHttpApp } from './common/http-bootstrap';
import { captureApiException, initApiSentry } from './common/observability/sentry';
import { registerProcessFailureHandlers } from './common/process-failure-handlers';

const PORT = process.env['PORT'] ? Number(process.env['PORT']) : 4000;

initApiSentry();
registerProcessFailureHandlers(undefined, (reason, context) =>
  captureApiException(reason, context),
);

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    // Fastify's own log line, the proxy trust: one owner, which the edge tests run too.
    new FastifyAdapter(fastifyAdapterOptions({ logger: process.env['NODE_ENV'] !== 'test' })),
  );

  // Cookies, uploads, the global pipe and filter, the prefix and CORS: one owner, which the
  // edge tests run too (common/http-bootstrap.ts).
  await configureHttpApp(app, { reportException: captureApiException });

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
