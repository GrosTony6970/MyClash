import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

const PORT = process.env['PORT'] ? Number(process.env['PORT']) : 4000;

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: process.env['NODE_ENV'] !== 'test' }),
  );

  // ── Global prefix ────────────────────────────────────────────────────────
  app.setGlobalPrefix('api/v1', {
    // Health and version endpoints live at root /api/... not /api/v1/...
    exclude: ['health', 'version'],
  });

  // ── OpenAPI / Swagger (dev only) ─────────────────────────────────────────
  if (process.env['NODE_ENV'] !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('MyClash API')
      .setDescription(
        'Free, open-source platform for HEMA event management — REST API',
      )
      .setVersion('1.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  await app.listen(PORT, '0.0.0.0');
  console.info(`MyClash API listening on http://0.0.0.0:${PORT}`);
  console.info(`Swagger UI: http://localhost:${PORT}/api/docs`);
}

void bootstrap();
