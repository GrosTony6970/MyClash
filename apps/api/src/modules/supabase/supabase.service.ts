import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface SupabaseAuthUser {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
}

export interface SupabaseAdminUser extends SupabaseAuthUser {
  email_confirmed_at?: string | null;
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
    email_confirmed_at: record.email_confirmed_at,
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
 * The Supabase URL in dev is the Kong gateway at http://kong:8000.
 * In production it is https://app.${DOMAIN} (routed through Traefik → Kong).
 */
@Injectable()
export class SupabaseService {
  readonly anon: SupabaseClient;
  readonly service: SupabaseClient;

  constructor(private readonly config: ConfigService) {
    const url = config.getOrThrow<string>('SUPABASE_URL');
    const anonKey = config.getOrThrow<string>('SUPABASE_ANON_KEY');
    const serviceKey = config.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY');

    this.anon = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    this.service = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async getAuthUser(accessToken: string): Promise<SupabaseAuthUser | null> {
    const authUrl =
      this.config.get<string>('SUPABASE_AUTH_INTERNAL_URL') ??
      this.config.getOrThrow<string>('SUPABASE_URL');
    const anonKey = this.config.getOrThrow<string>('SUPABASE_ANON_KEY');

    let response: {
      ok: boolean;
      json: () => Promise<unknown>;
    };

    try {
      response = await fetch(`${authUrl.replace(/\/+$/u, '')}/user`, {
        method: 'GET',
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${accessToken}`,
        },
      });
    } catch {
      return null;
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = null;
    }

    if (!response.ok || !body || typeof body !== 'object') {
      return null;
    }

    const record = body as Record<string, unknown>;
    if (isAuthUser(record)) return record;
    if (isAuthUser(record['user'])) return record['user'];
    return null;
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
