import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { FastifyRequest } from 'fastify';
import { presentedLogin } from '../../common/auth/identity';
import { requireRequestUserId } from '../../common/auth/request-user';
import { GOTRUE_TIMEOUT_MS, type SupabaseService } from '../supabase/supabase.service';

/** The person's own login, raw, once it is known to be a live one. */
export async function signedInLogin(
  req: FastifyRequest,
  supabase: SupabaseService,
): Promise<string> {
  const login = presentedLogin(req);
  if (!login) throw new UnauthorizedException('Authentication required');
  await requireRequestUserId(req, supabase);
  return login;
}

/** What one call to GoTrue is, as the person's own login makes it. */
export interface GoTrueCall {
  /** Path and query, starting with `/`. */
  path: string;
  /** The person's raw login, sent as the Bearer token. */
  login: string;
  method: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
}

/**
 * The one owner of "call GoTrue as this person": the internal address
 * (SUPABASE_AUTH_INTERNAL_URL, required: SUPABASE_URL is the web app, not GoTrue), the anon key, the Bearer login, and the timeout. No Origin header: GoTrue
 * accepts an empty one from a server, and checks any other against its SITE_URL.
 *
 * A call that gets no answer (timeout, refused connection) throws what `noAnswer` builds from
 * the reason; each caller words its own 503. Statuses are the caller's to read.
 */
export async function callGoTrueAsPerson(
  config: ConfigService,
  call: GoTrueCall,
  noAnswer: (why: string) => Error,
): Promise<Response> {
  const authUrl = config.getOrThrow<string>('SUPABASE_AUTH_INTERNAL_URL');
  const headers: Record<string, string> = {
    apikey: config.getOrThrow<string>('SUPABASE_ANON_KEY'),
    Authorization: `Bearer ${call.login}`,
  };
  if (call.body !== undefined) headers['Content-Type'] = 'application/json';

  try {
    return await fetch(`${authUrl.replace(/\/+$/u, '')}${call.path}`, {
      method: call.method,
      headers,
      ...(call.body !== undefined ? { body: JSON.stringify(call.body) } : {}),
      signal: AbortSignal.timeout(GOTRUE_TIMEOUT_MS),
    });
  } catch (error) {
    throw noAnswer(`no answer (${error instanceof Error ? error.name : 'unknown'})`);
  }
}
