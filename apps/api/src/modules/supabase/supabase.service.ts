import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface SupabaseAuthUser {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
}

function isAuthUser(value: unknown): value is SupabaseAuthUser {
  return Boolean(
    value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string',
  );
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
}
