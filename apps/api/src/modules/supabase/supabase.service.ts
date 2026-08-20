import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type SupabaseClient } from '@supabase/supabase-js';
import * as jwt from 'jsonwebtoken';
import { createInstrumentedClients } from './query-errors/install';
import { classifyGoTrueFailure } from './gotrue-failure';

/** How long to wait on GoTrue before treating it as unavailable (ms). */
const GOTRUE_TIMEOUT_MS = 5000;

export interface SupabaseAuthUser {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
  created_at?: string;
  last_sign_in_at?: string | null;
  banned_until?: string | null;
}

/** Tokens returned by GoTrue's `/token` endpoint (password & refresh grants). */
export interface SupabaseTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  user?: { id?: string };
}

/**
 * Result of asking GoTrue to validate an access token.
 *  - `ok`          — token is valid; `user` is populated.
 *  - `invalid`     — GoTrue actively rejected it (401/403/bad body). Not authed.
 *  - `unavailable` — GoTrue couldn't be reached OR wouldn't answer
 *                    (timeout/network/5xx/429/408); the caller should fall back
 *                    to local verification rather than logging the user out
 *                    over a transient blip. `classifyGoTrueFailure` owns the
 *                    line between the two.
 */
type GoTrueValidation =
  { status: 'ok'; user: SupabaseAuthUser } | { status: 'invalid' } | { status: 'unavailable' };

/**
 * Verify a Supabase access token locally (HS256, shared JWT secret). Returns the
 * user built from the JWT claims, or null if the signature/expiry is invalid or
 * the secret is not configured. Used as a fallback when GoTrue is unreachable so
 * a still-valid token doesn't get logged out by an infra hiccup.
 */
function verifyAccessTokenLocally(accessToken: string, secret: string): SupabaseAuthUser | null {
  try {
    const payload = jwt.verify(accessToken, secret, { algorithms: ['HS256'] });
    if (!payload || typeof payload !== 'object') return null;
    const claims = payload as jwt.JwtPayload & {
      email?: unknown;
      user_metadata?: unknown;
      app_metadata?: unknown;
    };
    if (typeof claims.sub !== 'string') return null;
    return {
      id: claims.sub,
      email: typeof claims.email === 'string' ? claims.email : undefined,
      user_metadata:
        claims.user_metadata && typeof claims.user_metadata === 'object'
          ? (claims.user_metadata as Record<string, unknown>)
          : undefined,
      app_metadata:
        claims.app_metadata && typeof claims.app_metadata === 'object'
          ? (claims.app_metadata as Record<string, unknown>)
          : undefined,
    };
  } catch {
    return null;
  }
}

export interface SupabaseAdminUser extends SupabaseAuthUser {
  email_confirmed_at?: string | null;
  /**
   * auth.users.updated_at — moves forward when the password (and a few
   * other fields) change. Used by admin-users.service to detect "the
   * user has reset their own password" without a webhook.
   */
  updated_at?: string | null;
}

export interface GoTrueAdminResponse<T> {
  ok: boolean;
  status: number;
  data: T | null;
  detail: unknown;
}

function isAuthUser(value: unknown): value is SupabaseAuthUser {
  return Boolean(
    value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string',
  );
}

function parseAdminUser(value: unknown): SupabaseAdminUser | null {
  if (!isAuthUser(value)) return null;
  const record = value as SupabaseAdminUser;
  return {
    id: record.id,
    email: record.email,
    user_metadata: record.user_metadata,
    app_metadata: record.app_metadata,
    created_at: record.created_at,
    last_sign_in_at: record.last_sign_in_at,
    banned_until: record.banned_until,
    email_confirmed_at: record.email_confirmed_at,
    updated_at: record.updated_at,
  };
}

/**
 * Thin wrapper around the Supabase JS client.
 *
 * Two clients are exposed:
 *  - `anon`    — uses the anon key; respects RLS. Use for user-context reads.
 *  - `service` — uses the service-role key; bypasses RLS. Use for server-side
 *                mutations (e.g. setting claim_status after magic-link click).
 *
 * SUPABASE_URL points at Traefik in both environments — https://app.${DOMAIN}
 * in production, https://api.myclash.localhost in dev. Traefik owns the
 * /auth/v1, /rest/v1 and /storage/v1 rewrites; there is no Kong gateway.
 */
@Injectable()
export class SupabaseService {
  readonly anon: SupabaseClient;
  readonly service: SupabaseClient;

  constructor(private readonly config: ConfigService) {
    // Both clients carry the swallowed-error tripwire; query-errors/install.ts
    // owns that wiring, including the un-instrumented client the recorder writes
    // through so a database outage cannot recurse.
    const clients = createInstrumentedClients(
      config.getOrThrow<string>('SUPABASE_URL'),
      config.getOrThrow<string>('SUPABASE_ANON_KEY'),
      config.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY'),
    );
    this.anon = clients.anon;
    this.service = clients.service;
  }

  async getAuthUser(accessToken: string): Promise<SupabaseAuthUser | null> {
    // GoTrue is the source of truth (so revoked/banned users are rejected
    // promptly), but a transient GoTrue outage must not log everyone out:
    // on `unavailable` we fall back to verifying the JWT locally with the
    // shared secret. A clean rejection (`invalid`) is honoured as-is.
    const validation = await this.validateAgainstGoTrue(accessToken);
    if (validation.status === 'ok') return validation.user;
    if (validation.status === 'invalid') return null;

    const secret = this.config.get<string>('SUPABASE_JWT_SECRET');
    return secret ? verifyAccessTokenLocally(accessToken, secret) : null;
  }

  /**
   * Signature-only check of an access token, with no GoTrue round-trip.
   *
   * For AuthGuard, which runs on every request: asking GoTrue 573 times per
   * request-wave is not viable, and an anonymous caller carries no token and so
   * costs nothing here.
   *
   * The trade-off is deliberate and bounded: unlike `getAuthUser`, this does not
   * see revocations, so a revoked token stays accepted until it expires
   * (GOTRUE_JWT_EXP=3600, i.e. <=1h). That only widens *authentication* — every
   * caller that authoritatively checks revocation today still calls
   * `getAuthUser`, and those paths are untouched. Do not repoint them at this
   * method without deciding to accept the <=1h gap everywhere.
   */
  verifyAccessTokenLocal(accessToken: string): SupabaseAuthUser | null {
    const secret = this.config.get<string>('SUPABASE_JWT_SECRET');
    return secret ? verifyAccessTokenLocally(accessToken, secret) : null;
  }

  private async validateAgainstGoTrue(accessToken: string): Promise<GoTrueValidation> {
    const authUrl =
      this.config.get<string>('SUPABASE_AUTH_INTERNAL_URL') ??
      this.config.getOrThrow<string>('SUPABASE_URL');
    const anonKey = this.config.getOrThrow<string>('SUPABASE_ANON_KEY');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GOTRUE_TIMEOUT_MS);

    let response: { ok: boolean; status: number; json: () => Promise<unknown> };
    try {
      response = await fetch(`${authUrl.replace(/\/+$/u, '')}/user`, {
        method: 'GET',
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${accessToken}`,
        },
        signal: controller.signal,
      });
    } catch {
      // Network error or aborted (timeout) → GoTrue is unreachable.
      return { status: 'unavailable' };
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) return { status: classifyGoTrueFailure(response.status) };

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { status: 'invalid' };
    }

    if (!body || typeof body !== 'object') return { status: 'invalid' };
    const record = body as Record<string, unknown>;
    if (isAuthUser(record)) return { status: 'ok', user: record };
    if (isAuthUser(record['user'])) {
      return { status: 'ok', user: record['user'] as SupabaseAuthUser };
    }
    return { status: 'invalid' };
  }

  /**
   * Exchange a refresh token for a fresh session via GoTrue's refresh grant.
   * Returns the new tokens, or null if the refresh token is invalid/expired or
   * GoTrue is unreachable. Captures whatever refresh_token GoTrue returns so it
   * works whether or not refresh-token rotation is enabled.
   */
  async refreshSession(refreshToken: string): Promise<SupabaseTokenResponse | null> {
    const authUrl =
      this.config.get<string>('SUPABASE_AUTH_INTERNAL_URL') ??
      this.config.getOrThrow<string>('SUPABASE_URL');
    const anonKey = this.config.getOrThrow<string>('SUPABASE_ANON_KEY');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GOTRUE_TIMEOUT_MS);

    let response: { ok: boolean; status: number; json: () => Promise<unknown> };
    try {
      response = await fetch(`${authUrl.replace(/\/+$/u, '')}/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: anonKey,
        },
        body: JSON.stringify({ refresh_token: refreshToken }),
        signal: controller.signal,
      });
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) return null;

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return null;
    }

    if (!body || typeof body !== 'object') return null;
    const record = body as Record<string, unknown>;
    if (typeof record['access_token'] !== 'string' || typeof record['refresh_token'] !== 'string') {
      return null;
    }
    return {
      access_token: record['access_token'],
      refresh_token: record['refresh_token'],
      expires_in: typeof record['expires_in'] === 'number' ? record['expires_in'] : undefined,
      user: record['user'] as { id?: string } | undefined,
    };
  }

  async listAuthAdminUsers(
    page: number,
    perPage: number,
  ): Promise<GoTrueAdminResponse<{ users: SupabaseAdminUser[] }>> {
    const response = await this.requestGoTrueAdmin<{ users?: unknown }>(
      `/admin/users?page=${encodeURIComponent(String(page))}&per_page=${encodeURIComponent(
        String(perPage),
      )}`,
      { method: 'GET' },
    );

    const rawUsers = Array.isArray(response.data?.users) ? response.data.users : [];
    return {
      ...response,
      data: response.ok
        ? { users: rawUsers.map(parseAdminUser).filter((user) => user !== null) }
        : null,
    };
  }

  async countAuthAdminUsers(): Promise<GoTrueAdminResponse<{ total: number }>> {
    const response = await this.requestGoTrueAdmin<{ total?: number; users?: unknown }>(
      '/admin/users?page=1&per_page=1',
      { method: 'GET' },
    );
    const total = typeof response.data?.total === 'number' ? response.data.total : 0;
    return { ...response, data: response.ok ? { total } : null };
  }

  async createAuthAdminUser(input: {
    email: string;
    password: string;
    email_confirm: boolean;
    user_metadata?: Record<string, unknown>;
  }): Promise<GoTrueAdminResponse<SupabaseAdminUser>> {
    const response = await this.requestGoTrueAdmin<unknown>('/admin/users', {
      method: 'POST',
      body: JSON.stringify(input),
    });

    const user =
      parseAdminUser(response.data) ?? parseAdminUser((response.data as { user?: unknown })?.user);
    return { ...response, data: response.ok ? user : null };
  }

  async getAuthAdminUser(userId: string): Promise<GoTrueAdminResponse<SupabaseAdminUser>> {
    const response = await this.requestGoTrueAdmin<unknown>(
      `/admin/users/${encodeURIComponent(userId)}`,
      { method: 'GET' },
    );

    const user =
      parseAdminUser(response.data) ?? parseAdminUser((response.data as { user?: unknown })?.user);
    return { ...response, data: response.ok ? user : null };
  }

  async updateAuthAdminUser(
    userId: string,
    input: Record<string, unknown>,
  ): Promise<GoTrueAdminResponse<SupabaseAdminUser>> {
    const response = await this.requestGoTrueAdmin<unknown>(
      `/admin/users/${encodeURIComponent(userId)}`,
      {
        method: 'PUT',
        body: JSON.stringify(input),
      },
    );

    const user =
      parseAdminUser(response.data) ?? parseAdminUser((response.data as { user?: unknown })?.user);
    return { ...response, data: response.ok ? user : null };
  }

  async deleteAuthAdminUser(userId: string): Promise<GoTrueAdminResponse<unknown>> {
    return this.requestGoTrueAdmin<unknown>(`/admin/users/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
    });
  }

  private async requestGoTrueAdmin<T>(
    requestPath: string,
    init: RequestInit,
  ): Promise<GoTrueAdminResponse<T>> {
    const authUrl =
      this.config.get<string>('SUPABASE_AUTH_INTERNAL_URL') ??
      this.config.getOrThrow<string>('SUPABASE_URL');
    const serviceRoleKey = this.config.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY');

    let response: Response;
    try {
      response = await fetch(`${authUrl.replace(/\/+$/u, '')}${requestPath}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          ...init.headers,
        },
      });
    } catch (error) {
      return { ok: false, status: 0, data: null, detail: String(error) };
    }

    const text = await response.text();
    let detail: unknown = null;
    if (text) {
      try {
        detail = JSON.parse(text);
      } catch {
        detail = { raw: text };
      }
    }

    return {
      ok: response.ok,
      status: response.status,
      data: response.ok ? (detail as T) : null,
      detail,
    };
  }
}
