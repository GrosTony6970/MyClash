/**
 * The resource metadata Claude fetches before it signs anyone in (RFC 9728), through the real
 * HTTP stack: `configureHttpApp` applies the prefix with its exclusion list, so this proves the
 * two paths answer at the root and nowhere under `/api/v1`.
 */
import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configureHttpApp } from '../../common/http-bootstrap';
import { MCP_SCOPES, PROTECTED_RESOURCE_PATHS } from './mcp-urls';
import { ProtectedResourceController } from './protected-resource.controller';

const env: Record<string, string> = {
  DOMAIN: 'myclash.fr',
  SUPABASE_URL: 'https://app.myclash.fr/',
};

let app: NestFastifyApplication;
let origin: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [ProtectedResourceController],
    providers: [
      {
        provide: ConfigService,
        useValue: {
          getOrThrow: (key: string) => {
            const value = env[key];
            if (value === undefined) throw new Error(`missing ${key}`);
            return value;
          },
        },
      },
    ],
  }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
    logger: false,
  });
  await configureHttpApp(app, { reportException: () => undefined, requestLog: false });
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as { port: number };
  origin = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await app.close();
});

describe('the protected-resource metadata, over HTTP', () => {
  it.each(PROTECTED_RESOURCE_PATHS)('answers /%s with no login', async (path) => {
    const res = await fetch(`${origin}/${path}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      resource: 'https://api.myclash.fr/api/v1/mcp',
      authorization_servers: ['https://app.myclash.fr/auth/v1'],
      scopes_supported: [...MCP_SCOPES],
      bearer_methods_supported: ['header'],
    });
  });

  it.each(PROTECTED_RESOURCE_PATHS)('does not answer /api/v1/%s', async (path) => {
    const res = await fetch(`${origin}/api/v1/${path}`);
    expect(res.status).toBe(404);
  });
});
