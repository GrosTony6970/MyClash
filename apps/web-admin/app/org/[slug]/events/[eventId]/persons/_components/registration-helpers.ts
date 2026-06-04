/**
 * Shared wrappers for the three admin POST sites that try to register
 * a person into a tournament. The backend
 * (`POST /api/v1/tournaments/:id/registrations`) returns 409 with
 * `details.reason: 'tournament_full'` when capacity is reached — see
 * apps/api/src/modules/registrations/registrations.service.ts:120-174.
 * Duplicate registrations come back as 400 on a different path, so the
 * 409 reliably means "full" and the FE can offer a waiting-list
 * affordance with one click.
 *
 * Pure functions — kept React-free for easy fetch-mocked unit tests.
 */

export type RegisterOutcome =
  | { status: 'ok'; data: unknown }
  | {
      status: 'full';
      registeredCount: number;
      maxParticipants: number;
    }
  | { status: 'error'; message: string };

interface BackendErrorBody {
  statusCode?: number;
  code?: string;
  message?: string;
  details?: {
    reason?: string;
    registeredCount?: number;
    maxParticipants?: number;
  };
}

const FALLBACK_REGISTRATION_ERROR = 'Registration failed';
const FALLBACK_WAITLIST_ERROR = 'Could not add to the waiting list';

export async function tryRegisterInTournament(
  apiUrl: string,
  tournamentId: string,
  body: Record<string, unknown>,
): Promise<RegisterOutcome> {
  let res: Response;
  try {
    res = await fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}/registrations`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return {
      status: 'error',
      message: err instanceof Error ? err.message : FALLBACK_REGISTRATION_ERROR,
    };
  }
  if (res.ok) {
    const data = await res.json().catch(() => null);
    return { status: 'ok', data };
  }
  const parsed = (await res.json().catch(() => ({}))) as BackendErrorBody;
  if (res.status === 409 && parsed.details?.reason === 'tournament_full') {
    return {
      status: 'full',
      registeredCount: parsed.details.registeredCount ?? 0,
      maxParticipants: parsed.details.maxParticipants ?? 0,
    };
  }
  return {
    status: 'error',
    message: parsed.message ?? FALLBACK_REGISTRATION_ERROR,
  };
}

export async function addToWaitingList(
  apiUrl: string,
  tournamentId: string,
  body: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; message: string }> {
  let res: Response;
  try {
    res = await fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}/waitlist`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : FALLBACK_WAITLIST_ERROR };
  }
  if (res.ok) return { ok: true };
  const parsed = (await res.json().catch(() => ({}))) as BackendErrorBody;
  return { ok: false, message: parsed.message ?? FALLBACK_WAITLIST_ERROR };
}
