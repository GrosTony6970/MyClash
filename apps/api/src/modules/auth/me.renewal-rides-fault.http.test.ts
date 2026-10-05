import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import fastifyCookie from '@fastify/cookie';
import type { FastifyReply } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiExceptionFilter } from '../../common/api-exception.filter';
import { API_GLOBAL_PREFIX } from '../../common/global-prefix';
import { AuthService } from './auth.service';
import { MeController } from './me.controller';

/**
 * A real request through the real router, the cookie plugin and the error filter
 * (ruling 302).
 *
 * `/me` renews the login first and reads the role, the clubs and the League grant
 * after it. Since ruling 295 a fault of one of those reads is a server error. The
 * browser's renewal sends the refused request again on that error, which is right
 * only when the renewed cookies ride the error answer: this proves they do.
 */
type CookieReply = FastifyReply & {
  setCookie: (name: string, value: string, options: Record<string, unknown>) => void;
};

const auth = {
  getMe: async (_request: unknown, reply: CookieReply) => {
    reply.setCookie('sb-access-token', 'renewed', { path: '/', httpOnly: true });
    throw new Error('Platform role of u1 unreadable: connection refused');
  },
};

let app: NestFastifyApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [MeController],
    providers: [{ provide: AuthService, useValue: auth }],
  }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.register(fastifyCookie);
  app.setGlobalPrefix(API_GLOBAL_PREFIX);
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
});

describe('GET /me whose read fails after the login was renewed', () => {
  it('answers a server error that still carries the renewed login cookie', async () => {
    const res = await app.inject({ method: 'GET', url: `/${API_GLOBAL_PREFIX}/me` });
    expect(res.statusCode).toBe(500);
    expect(String(res.headers['set-cookie'])).toContain('sb-access-token=renewed');
  });
});
