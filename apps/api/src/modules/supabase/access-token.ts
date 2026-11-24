import * as jwt from 'jsonwebtoken';
import type { SupabaseAuthUser } from './supabase.service';

/**
 * Reading a Supabase access token without asking GoTrue: the local check of its signature and
 * expiry, and the unverified `client_id` claim the connector wall reads.
 */

/**
 * The `client_id` claim of a token, read WITHOUT verifying it, or null when the
 * token has none (or is not a token). Fails closed on purpose: a forged claim can
 * only get its own sender refused by the connector wall, and the wall must not
 * depend on local verification succeeding (an expired token, a missing secret or
 * a future key switch would otherwise let GoTrue-validated paths accept it).
 * Never use this to identify anyone.
 */
export function connectorClaimOf(token: string): string | null {
  try {
    const payload = jwt.decode(token);
    if (!payload || typeof payload !== 'object') return null;
    const clientId = (payload as { client_id?: unknown }).client_id;
    return typeof clientId === 'string' && clientId ? clientId : null;
  } catch {
    return null;
  }
}

/**
 * True when the token carries a valid HS256 signature of the shared secret, whatever its expiry.
 * An expired token of ours is still ours; a made-up one is not. No secret means false.
 */
export function signedByAuthServer(token: string, secret: string): boolean {
  if (!secret) return false;
  try {
    jwt.verify(token, secret, { algorithms: ['HS256'], ignoreExpiration: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Verify a Supabase access token locally (HS256, shared JWT secret). Returns the
 * user built from the JWT claims, or null if the signature/expiry is invalid or
 * the secret is not configured. Used as a fallback when GoTrue is unreachable so
 * a still-valid token doesn't get logged out by an infra hiccup.
 */
export function verifyAccessTokenLocally(token: string, secret: string): SupabaseAuthUser | null {
  try {
    const payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
    if (!payload || typeof payload !== 'object') return null;
    const claims = payload as jwt.JwtPayload & {
      email?: unknown;
      user_metadata?: unknown;
      app_metadata?: unknown;
      client_id?: unknown;
    };
    if (typeof claims.sub !== 'string') return null;
    return {
      id: claims.sub,
      clientId:
        typeof claims.client_id === 'string' && claims.client_id ? claims.client_id : undefined,
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
