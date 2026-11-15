import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { AppModule } from './app.module';
import { fastifyAdapterOptions } from './common/fastify-adapter-options';
import { enableGracefulStop } from './common/graceful-stop';
import { configureHttpApp } from './common/http-bootstrap';
import { captureApiException, flushApiSentry, initApiSentry } from './common/observability/sentry';
import { registerProcessFailureHandlers } from './common/process-failure-handlers';
import { processRole } from './common/process-role';
import { startOrExit } from './common/start-or-exit';
import { startWorker } from './workers/worker-role';

const PORT = process.env['PORT'] ? Number(process.env['PORT']) : 4000;

initApiSentry();
registerProcessFailureHandlers(
  undefined,
  (reason, context) => captureApiException(reason, context),
  flushApiSentry,
);

/** The API: every route, no queue consumer and no auto-lock scan (rulings 808, 809). */
async function startApi(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    // Fastify's own log line, the proxy trust: one owner, which the edge tests run too.
    new FastifyAdapter(fastifyAdapterOptions({ logger: process.env['NODE_ENV'] !== 'test' })),
    // A wiring error rejects instead of ending the process here, so startOrExit reports it like
    // any other failed start.
    { abortOnError: false },
  );

  // The request log, cookies, uploads, the global pipe and filter, the prefix and CORS: one
  // owner, which the edge tests run too (common/http-bootstrap.ts).
  await configureHttpApp(app, { reportException: captureApiException });
  // A stop signal closes the app, then exits 0 (common/graceful-stop.ts).
  enableGracefulStop(app);

  // ── OpenAPI / Swagger (dev only) ─────────────────────────────────────────
  const swagger = process.env['NODE_ENV'] !== 'production';
  if (swagger) {
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
  if (swagger) console.info(`Swagger UI: http://localhost:${PORT}/api/docs`);
}

/** The worker: the same graph with no HTTP, its jobs started, /health alone (worker-role.ts). */
async function startWorkerProcess(): Promise<void> {
  await startWorker(
    () => NestFactory.createApplicationContext(AppModule, { abortOnError: false }),
    PORT,
  );
}

// `--worker` picks the role (common/process-role.ts). A start that fails or hangs ends the
// process, so Docker starts it again, whichever the role.
void startOrExit(processRole(process.argv) === 'worker' ? startWorkerProcess : startApi, {
  logger: new Logger('Start'),
  report: (reason, context) => captureApiException(reason, context),
  flush: flushApiSentry,
});
