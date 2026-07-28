/**
 * Emit the API's OpenAPI JSON WITHOUT a running server or infra.
 *
 * Boots the compiled Nest app (dist/ — run `pnpm --filter @myclash/api build`
 * first) with stub env and no listen, builds the Swagger document, writes it to
 * the path given as argv[2] (default openapi.json).
 *
 * The global prefix is IMPORTED from dist rather than restated here. This file
 * used to claim it built the document "exactly like main.ts" while carrying its
 * own copy of the exclude list, which is precisely how the two drifted.
 *
 * Usage:
 *   pnpm --filter @myclash/api build
 *   node apps/api/scripts/emit-openapi.cjs openapi.json
 *   npx openapi-typescript openapi.json --output packages/api-client/src/generated/schema.ts
 */
process.env.NODE_ENV = 'development';
process.env.DATABASE_URL ??= 'postgres://stub:stub@127.0.0.1:9/stub';
process.env.REDIS_URL ??= 'redis://127.0.0.1:9';
process.env.SUPABASE_URL ??= 'http://127.0.0.1:9';
process.env.SUPABASE_JWT_SECRET ??= 'stub-secret-stub-secret-stub-secret!!';
process.env.SUPABASE_ANON_KEY ??= 'stub';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'stub';
process.env.MYCLASH_GUEST_JWT_SECRET ??= 'stub-guest-secret';
process.env.MYCLASH_STAFF_JWT_SECRET ??= 'stub-staff-secret';
process.env.COOKIE_SECRET ??= 'stub-cookie-secret';
process.env.DOMAIN ??= 'myclash.localhost';
process.env.HEMA_RATINGS_SYNC_ENABLED = 'false';
process.env.RESEND_API_KEY ??= 'stub';
process.env.MAIL_FROM ??= 'stub@myclash.localhost';
process.env.OPS_RUNNER_URL ??= 'http://127.0.0.1:9';
process.env.OPS_RUNNER_SECRET ??= 'stub';
process.env.AI_KEY_SECRET ??= 'stub-ai-key-secret-32-chars-long!!';

const { writeFileSync } = require('node:fs');
const { NestFactory } = require('@nestjs/core');
const { FastifyAdapter } = require('@nestjs/platform-fastify');
const { DocumentBuilder, SwaggerModule } = require('@nestjs/swagger');
const { cleanupOpenApiDoc } = require('nestjs-zod');
const { AppModule } = require('../dist/app.module');
// Same constants main.ts applies — NOT a copy. A literal here silently taught
// the generated client a different route shape than the server serves.
const { API_GLOBAL_PREFIX, API_GLOBAL_PREFIX_EXCLUDE } = require('../dist/common/global-prefix');

async function main() {
  const app = await NestFactory.create(AppModule, new FastifyAdapter(), {
    logger: ['error'],
    abortOnError: false,
  });
  app.setGlobalPrefix(API_GLOBAL_PREFIX, { exclude: API_GLOBAL_PREFIX_EXCLUDE });
  const config = new DocumentBuilder()
    .setTitle('MyClash API')
    .setVersion('1.0')
    .addBearerAuth()
    .addCookieAuth('sb-access-token')
    .build();
  const document = cleanupOpenApiDoc(SwaggerModule.createDocument(app, config));
  writeFileSync(process.argv[2] ?? 'openapi.json', JSON.stringify(document, null, 2));
  console.log('WROTE_OPENAPI paths=' + Object.keys(document.paths).length);
  process.exit(0);
}

main().catch((err) => {
  console.error('EMIT_FAILED', err && err.message ? err.message : err);
  process.exit(1);
});
